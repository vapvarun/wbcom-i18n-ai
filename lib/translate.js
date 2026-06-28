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
    `Return ONLY a compact JSON object mapping each input key to its ${loc.name} translation - no markdown, no commentary. ` +
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
  const batchSize = cfg.batch || 40;

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
  for (let i = 0; i < total; i += batchSize) {
    const chunk = items.slice(i, i + batchSize);
    const input = {};
    chunk.forEach((it, j) => { input[j] = it.src; });
    let res;
    try {
      res = await translateBatch(buildPrompt(cfg, loc, input), model, engine);
    } catch (err) {
      log(`  ${loc.locale}: batch ${i} error: ${err.message}`);
      continue;
    }
    chunk.forEach((it, j) => {
      const t = res[j] != null ? String(res[j]) : '';
      if (!t) return;
      it.e.msgstr[it.slot] = t;
      touched.add(it.e);
      filled++;
    });
    log(`  ${loc.locale}: ${Math.min(i + batchSize, total)}/${total}`);
  }

  // Crash-safety validation: any msgstr whose placeholders differ from its source
  // marks the WHOLE entry fuzzy -> gettext won't compile it -> English fallback.
  let fuzzy = 0;
  for (const e of touched) {
    let bad = false;
    if (e.msgid_plural) {
      if (e.msgstr[0] && !samePlaceholders(e.msgid, e.msgstr[0])) bad = true;
      for (let n = 1; n < nplurals; n++) if (e.msgstr[n] && !samePlaceholders(e.msgid_plural, e.msgstr[n])) bad = true;
    } else if (e.msgstr[0] && !samePlaceholders(e.msgid, e.msgstr[0])) {
      bad = true;
    }
    setFuzzy(e, bad);
    if (bad) fuzzy++;
  }

  fs.writeFileSync(poPath, po.compile(data));
  log(`DONE ${loc.locale}: filled=${filled} fuzzy(placeholder-fallback)=${fuzzy}`);
  return { total, filled, fuzzy };
}

module.exports = { translatePo };
