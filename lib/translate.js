'use strict';
const fs = require('fs');
const { po } = require('gettext-parser');
const { samePlaceholders, translateBatch, npluralsOf } = require('./util');

const DEFAULT_PROTECT = ['Jetonomy', 'Pro', 'WordPress', 'BuddyPress', 'REST', 'API', 'URL', 'CSV', 'AI', 'HTML', 'CSS'];

function buildPrompt(cfg, loc, input) {
  const protect = (cfg.protect || DEFAULT_PROTECT).join(', ');
  const gloss = cfg.glossary && Object.keys(cfg.glossary).length
    ? ` Use this glossary (English -> ${loc.name}) consistently: ${JSON.stringify(cfg.glossary)}.`
    : '';
  return (
    `Translate these WordPress plugin UI strings to ${loc.name} (${loc.locale}), ${loc.register || 'neutral'} register. ` +
    `The input is a JSON array of English strings. Return ONLY a compact JSON object whose KEYS are the EXACT input strings (verbatim, byte-for-byte, unchanged) ` +
    `and whose VALUES are the ${loc.name} translations - no markdown, no commentary, and include every input string as a key. ` +
    `PRESERVE EXACTLY, never translate or reorder: printf placeholders (%s, %d, %1$s, %2$d ...), HTML tags and entities, ` +
    `and these terms: ${protect}. Keep trailing punctuation/ellipsis and any leading/trailing spaces.${gloss} ` +
    `Input: ${JSON.stringify(input)}`
  );
}

function flagSet(entry) {
  return new Set((entry.comments && entry.comments.flag ? entry.comments.flag : '').split(',').map(s => s.trim()).filter(Boolean));
}
function setFuzzy(entry, on) {
  const flags = flagSet(entry);
  if (on) flags.add('fuzzy'); else flags.delete('fuzzy');
  entry.comments = entry.comments || {};
  entry.comments.flag = [...flags].join(', ');
}
function isFuzzy(entry) { return flagSet(entry).has('fuzzy'); }

/** Fill one locale .po in place. Returns {total, filled, fuzzy}. */
async function translatePo(poPath, loc, cfg, log = () => {}) {
  const data = po.parse(fs.readFileSync(poPath));
  const nplurals = npluralsOf(data.headers['plural-forms'] || data.headers['Plural-Forms']);
  const model = loc.model || cfg.model || 'haiku';
  const engine = cfg.engine || 'claude';
  const batchSize = cfg.batch || 80;

  // Collect slots needing translation: empty, or fuzzy (changed source via msgmerge).
  const items = [];
  const touched = new Set();
  for (const ctx of Object.keys(data.translations)) {
    for (const key of Object.keys(data.translations[ctx])) {
      const e = data.translations[ctx][key];
      if (e.msgid === '') continue; // header
      const fuzzy = isFuzzy(e);
      if (e.msgid_plural) {
        if (fuzzy || !e.msgstr[0]) items.push({ e, slot: 0, src: e.msgid });
        for (let n = 1; n < nplurals; n++) if (fuzzy || !e.msgstr[n]) items.push({ e, slot: n, src: e.msgid_plural });
      } else if (fuzzy || !e.msgstr[0]) {
        items.push({ e, slot: 0, src: e.msgid });
      }
    }
  }

  if (cfg.limit && items.length > cfg.limit) items.length = cfg.limit; // test cap
  const total = items.length;
  log(`${loc.locale}: ${total} strings to fill (model=${model}, engine=${engine}, nplurals=${nplurals})`);
  let filled = 0;
  const tries = cfg.retries || 3;

  // Translate a chunk; on persistent malformed-JSON failure, split and recurse so
  // a single quote-breaking string is isolated and skipped alone — not its 40
  // neighbours. (A 1-string chunk that still fails is the one bad string.)
  async function processChunk(chunk) {
    if (!chunk.length) return;
    // Key the batch by the SOURCE STRING itself, never by position. Numbered keys
    // let the model silently shift an entire batch's translations by one entry
    // (a dropped/merged item), mapping each msgstr onto the WRONG msgid. Keying by
    // the exact source makes that impossible: a value can only land on the msgid it
    // was translated from. A key the model fails to echo back is simply skipped and
    // re-filled on the next incremental run - never misaligned.
    const uniqueSrc = [...new Set(chunk.map(it => it.src))];
    let res = null;
    for (let attempt = 1; attempt <= tries && !res; attempt++) {
      try {
        res = await translateBatch(buildPrompt(cfg, loc, uniqueSrc), model, engine);
      } catch (err) {
        if (attempt === tries && chunk.length === 1) {
          log(`  ${loc.locale}: skipped 1 unparseable string: ${err.message}`);
        }
      }
    }
    if (!res || typeof res !== 'object') {
      if (chunk.length === 1) return; // give up on the single bad string
      const mid = Math.floor(chunk.length / 2);
      await processChunk(chunk.slice(0, mid));
      await processChunk(chunk.slice(mid));
      return;
    }
    // Exact-key lookup, then two forgiving fallbacks for when the model doesn't
    // echo a key byte-for-byte: trimmed whitespace, then a "loose" form that
    // normalises smart quotes/dashes/ellipsis to ASCII and collapses whitespace
    // (some models silently rewrite typographic punctuation in the keys they
    // echo, e.g. a curly apostrophe becomes a straight one). Fallbacks run only
    // after an exact miss, so they can only recover a translation, never shift one.
    const looseKey = s => s
      .replace(/[‘’‛′]/g, "'")
      .replace(/[“”″]/g, '"')
      .replace(/[–—]/g, '-')
      .replace(/…/g, '...')
      .replace(/\s+/g, ' ')
      .trim();
    const byTrim = new Map();
    const byLoose = new Map();
    for (const [k, v] of Object.entries(res)) {
      byTrim.set(k.trim(), v);
      byLoose.set(looseKey(k), v);
    }
    chunk.forEach((it) => {
      let val = Object.prototype.hasOwnProperty.call(res, it.src) ? res[it.src] : undefined;
      if (val == null && byTrim.has(it.src.trim())) val = byTrim.get(it.src.trim());
      if (val == null && byLoose.has(looseKey(it.src))) val = byLoose.get(looseKey(it.src));
      const t = val != null ? String(val) : '';
      if (!t) return;
      it.e.msgstr[it.slot] = t;
      touched.add(it.e);
      filled++;
    });
  }

  // Crash-safety: a msgstr whose placeholders differ from its source is flagged
  // fuzzy (gettext won't compile it -> English fallback, never a broken %s).
  const hasBadPlaceholders = (e) => {
    if (e.msgid_plural) {
      if (e.msgstr[0] && !samePlaceholders(e.msgid, e.msgstr[0])) return true;
      for (let n = 1; n < nplurals; n++) if (e.msgstr[n] && !samePlaceholders(e.msgid_plural, e.msgstr[n])) return true;
      return false;
    }
    return !!e.msgstr[0] && !samePlaceholders(e.msgid, e.msgstr[0]);
  };

  // Validate every touched entry, then write the .po. Called at each checkpoint
  // AND at the end — so a pause/crash never loses progress and the incremental
  // resume re-spends no quota. Returns the count flagged fuzzy.
  const persist = () => {
    let fuzzy = 0;
    for (const e of touched) {
      const bad = hasBadPlaceholders(e);
      setFuzzy(e, bad);
      if (bad) fuzzy++;
    }
    fs.writeFileSync(poPath, po.compile(data));
    return fuzzy;
  };

  const saveEvery = cfg.saveEvery || 200; // strings between checkpoints
  let sinceSave = 0;
  for (let i = 0; i < total; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    await processChunk(chunk);
    log(`  ${loc.locale}: ${Math.min(i + batchSize, total)}/${total}`);
    sinceSave += chunk.length;
    if (sinceSave >= saveEvery) { persist(); sinceSave = 0; }
  }

  const fuzzy = persist();
  log(`DONE ${loc.locale}: filled=${filled} fuzzy(placeholder-fallback)=${fuzzy}`);
  return { total, filled, fuzzy };
}

module.exports = { translatePo };
