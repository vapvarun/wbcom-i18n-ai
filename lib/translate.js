'use strict';
const fs = require('fs');
const { po } = require('gettext-parser');
const { samePlaceholders, translateBatch, npluralsOf } = require('./util');

const DEFAULT_PROTECT = ['Jetonomy', 'Pro', 'WordPress', 'BuddyPress', 'REST', 'API', 'URL', 'CSV', 'HTML', 'CSS'];

/**
 * The translation rules every batch carries. They come from the Wbcom
 * translation quality guideline (docs/translation-standard.md),
 * written after customers reported shipped translations as bad: verbs where a
 * label needed a noun ("Reply" -> fr "Répondre"), a wrong word for a core term
 * (de "Beitragsanfrage" for join request), one term rendered three ways, and
 * imperatives on German buttons. Each was a string translated with no context.
 */
const RULES = [
  'Translate the MEANING in context, never word for word. Read each item\'s context, note (the developer\'s translator comment), file and audience first.',
  'Know the kind of text: a button or menu item is an action; a label, tab or column heading is a noun or noun phrase; a status is a short adjective or noun; a message is a full sentence. The same English word can be a verb on a button and a noun on a label.',
  'Use the glossary rendering for every glossary term, in every string, with no second rendering. Where the glossary has no rendering yet, use the word the established community software in this language uses (Discourse, bbPress, BuddyPress, WordPress core) and keep it the same across the batch.',
  'WordPress core\'s own translation wins for anything core also says (Settings, Save Changes, Dashboard, Users, Draft, Publish).',
  'Follow the locale\'s UI conventions: German buttons and menu items use the infinitive (e.g. "Speichern"), not the imperative; follow the locale\'s capitalization and typography (French non-breaking space before : ; ! ? and « »; German „ “; full-width punctuation for Japanese and Chinese).',
  'Keep short labels short: a one or two word English button, tab or status stays one or two words.',
  'Placeholders such as %s stand for words described in the note. When a placeholder holds a noun the site owner can rename (for example "space label"), the placeholder IS that noun: never write the noun as well (never "einen Bereich (%s)", "un élément (%s)", "раздел (%s)"). You cannot know its gender or case, so put it where it needs no article or ending: at the start of a label or sentence, after a colon, or as a plain noun in a list ("%s: neu erstellen", "Neu in %s", "Alle %s"). Then read the sentence with the default word from the glossary in place of %s: it must read as natural text a native speaker would write.',
  'Admin text speaks to the site owner (plain, precise, no developer jargon); member text speaks to the member (friendly, short); email text is complete sentences.',
  'Never copy the English unless the whole string is a protected name.',
];

/**
 * A protected term is a proper noun - a product or brand name. It has no
 * translation in the target language, the way "Photoshop" has no German word. If the
 * source contains one, the translation must contain it verbatim.
 *
 * The prompt asks for this, but asking is not enough: a term that is also an ordinary
 * English word gets translated anyway. Translating the Reign theme, Haiku rendered
 * "Reign Settings" as "Herrschaft Einstellungen" (dominion settings) in German and
 * "Regno" (kingdom) in Italian, with "Reign" sitting in the protect list the whole
 * time - "reign" is simply a common word. So the terms are checked, not trusted.
 *
 * Matched case-insensitively on a word boundary. A miss flags the entry fuzzy, so
 * gettext leaves it out of the .mo and the string falls back to English rather than
 * shipping a mangled brand.
 */
// Word edges are letters of space-separated scripts only: Japanese, Chinese and Korean
// attach words straight to a name ("Jetonomyが", "Pro機能"), and that is not a dropped name.
const EDGE = '[^\\p{Script=Latin}\\p{Script=Cyrillic}\\p{Script=Greek}\\p{N}]';
function termRe(t, caseSensitive = false) {
  return new RegExp(`(^|${EDGE})${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(${EDGE}|$)`, caseSensitive ? 'u' : 'iu');
}
// An all-capitals protected term is an acronym (REST, API, URL): match it in capitals
// only, or the English word "rest" in "the rest of your site" counts as the REST API.
const isAcronym = (t) => /\p{Lu}/u.test(t) && t === t.toUpperCase();
function droppedTerms(source, translated, terms) {
  if (!translated) return [];
  return terms.filter((t) => termRe(t, isAcronym(t)).test(source) && !termRe(t, isAcronym(t)).test(translated));
}

/**
 * Glossary entries, normalised. Two shapes are accepted:
 *   flat (0.1):  { "Space": "Bereich" }                      - one rendering for every locale
 *   rich (0.2):  { "space": { "meaning": "...", "de_DE": "Bereich", "fr_FR": "espace" } }
 * Returns [{ term, meaning, use }] for this locale.
 */
function glossaryFor(cfg, loc) {
  return Object.entries(cfg.glossary || {}).map(([term, v]) => {
    if (v && typeof v === 'object') {
      return { term, meaning: v.meaning || '', use: v[loc.locale] || '' };
    }
    return { term, meaning: '', use: typeof v === 'string' ? v : '' };
  });
}

/** The glossary terms a batch actually contains (singular or simple plural), so the prompt stays small. */
function glossaryHits(gloss, sources) {
  const text = sources.join('\n');
  return gloss.filter((g) => termRe(g.term).test(text) || termRe(`${g.term}s`).test(text) || termRe(`${g.term}es`).test(text));
}

/**
 * Who reads a string, from where it is used. Admin text speaks to the site owner,
 * member text to the member, email text is sent. The first matching rule decides;
 * a project can add its own [regex, audience] pairs under config.audience.
 */
function audienceOf(entry, cfg) {
  const refs = String((entry.comments && entry.comments.reference) || '');
  for (const [re, who] of cfg.audience || []) {
    if (new RegExp(re).test(refs)) return who;
  }
  if (/(^|\/)(emails?|mail)(\/|-|_|\.)|email-templates/i.test(refs)) return 'email';
  if (/(^|\/)admin\/|wp-admin|(^|\/)settings|class-admin|-admin\.|admin-/i.test(refs)) return 'admin (site owner)';
  if (/(^|\/)(cli|bin)\//i.test(refs)) return 'admin (site owner, command line)';
  return 'member-facing (community pages)';
}

/** The developer's translator comment(s), cleaned of the "translators:" prefix. */
function noteOf(entry) {
  const ex = String((entry.comments && entry.comments.extracted) || '').trim();
  return ex.replace(/^translators:\s*/gim, '').replace(/\s+/g, ' ').trim();
}

function firstFile(entry) {
  const refs = String((entry.comments && entry.comments.reference) || '').trim();
  return refs ? refs.split(/\s+/)[0] : '';
}

function buildPrompt(cfg, loc, items, gloss, pluralRule) {
  const protect = (cfg.protect || DEFAULT_PROTECT).join(', ');
  const brief = cfg.brief ? `Product: ${cfg.brief}\n` : '';
  const glossText = gloss.length
    ? 'Glossary for this batch (term - what it means - the rendering to use):\n' +
      gloss.map((g) => `- ${g.term}${g.meaning ? ` - ${g.meaning}` : ''} - ${g.use ? `use "${g.use}"` : 'no rendering fixed yet: choose the established one and keep it consistent'}`).join('\n') + '\n'
    : '';
  const plural = pluralRule
    ? `Plural items have "plural" and "forms": return an ARRAY of exactly ${loc.nplurals} strings, one per plural form, in the order of this rule: ${pluralRule}\n`
    : '';
  return (
    `You are a professional ${loc.name} (${loc.locale}) software localiser for a WordPress plugin. Register: ${loc.register || 'neutral'}.\n` +
    brief +
    `Rules:\n${RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n` +
    `PRESERVE EXACTLY, never translate or reorder: printf placeholders (%s, %d, %1$s, %2$d ...), {tokens}, HTML tags and entities, ` +
    `and these protected names: ${protect}. Keep trailing punctuation/ellipsis and any leading/trailing spaces.\n` +
    glossText + plural +
    `Input: a JSON array of items. Each has "en" (the English), and when known "context", "note", "file", "audience", ` +
    `and "previous" (an earlier ${loc.name} translation: improve it if it breaks a rule, keep it if it is right).\n` +
    `Return ONLY a compact JSON object whose KEYS are the EXACT "en" strings (verbatim, byte-for-byte) and whose VALUES are the ${loc.name} translations ` +
    `- no markdown, no commentary, every item included.\n` +
    `Input: ${JSON.stringify(items)}`
  );
}

function buildReviewPrompt(cfg, loc, items, gloss) {
  const brief = cfg.brief ? `Product: ${cfg.brief}\n` : '';
  const glossText = gloss.length
    ? 'Glossary (term - meaning - rendering to use):\n' + gloss.map((g) => `- ${g.term}${g.meaning ? ` - ${g.meaning}` : ''}${g.use ? ` - "${g.use}"` : ''}`).join('\n') + '\n'
    : '';
  return (
    `You are a senior ${loc.name} (${loc.locale}) localisation reviewer for a WordPress plugin. Register: ${loc.register || 'neutral'}.\n` +
    brief +
    `Check each translation against these rules:\n${RULES.map((r, i) => `${i + 1}. ${r}`).join('\n')}\n` +
    glossText +
    `Also check grammar, spelling, natural wording for a native speaker, and that placeholders, HTML and protected names are unchanged.\n` +
    `Input: a JSON array of items with "en", optional "context", "note", "file", "audience", and "tr" (the translation; an array for plural forms).\n` +
    `Return ONLY a compact JSON object whose KEYS are the EXACT "en" strings and whose VALUES are the corrected translation (same shape as "tr"), ` +
    `or an empty string "" when the translation is already right. No markdown, no commentary.\n` +
    `Input: ${JSON.stringify(items)}`
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

/** HTML tag names, sorted, so a translation that drops or adds a tag is caught. */
function tags(s) {
  return ((s || '').match(/<\/?[a-z][a-z0-9-]*/gi) || []).map((t) => t.toLowerCase()).sort();
}
function sameTags(a, b) {
  const x = tags(a), y = tags(b);
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

/**
 * A translation that is just the English, for a string that is not entirely a
 * protected name or placeholder. It would count as done and show English forever.
 */
function copiedEnglish(source, translated, protect) {
  if (!translated || translated.trim() !== source.trim()) return false;
  // Addresses and emails stay as they are.
  if (/:\/\/|@|^\s*www\./i.test(source)) return false;
  let rest = source.replace(/%%|%(?:\d+\$)?[bcdeEfFgGosuxX]/g, '').replace(/<[^>]+>/g, '').replace(/\{[^}]+\}/g, '');
  for (const t of protect) rest = rest.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '');
  // Only an ordinary lower-case word marks UI text (UI strings are sentence case);
  // product names (WooCommerce, Tutor LMS, Wbcom Designs) are capitalised and stay.
  return /(^|[^\p{L}])\p{Ll}{3,}/u.test(rest);
}

/** Fill (or, with reviewAll, re-review) one locale .po in place. */
async function translatePo(poPath, loc, cfg, log = () => {}) {
  const data = po.parse(fs.readFileSync(poPath));
  const pluralRule = data.headers['plural-forms'] || data.headers['Plural-Forms'] || '';
  const nplurals = npluralsOf(pluralRule);
  const model = loc.model || cfg.model || 'sonnet';
  const reviewModel = loc.reviewModel || cfg.reviewModel || model;
  const engine = cfg.engine || 'claude';
  const batchSize = cfg.batch || 40;
  const review = cfg.review !== false;
  const protect = cfg.protect || DEFAULT_PROTECT;
  const gloss = glossaryFor(cfg, loc);
  const L = { ...loc, nplurals };

  // One item per ENTRY, all plural forms together, so a language with three forms
  // gets three different strings rather than one string copied into each slot.
  // Empty and fuzzy entries are always taken; with reviewAll translated ones too,
  // carrying their current text as "previous".
  const items = [];
  for (const ctx of Object.keys(data.translations)) {
    for (const key of Object.keys(data.translations[ctx])) {
      const e = data.translations[ctx][key];
      if (e.msgid === '') continue; // header
      const missing = e.msgid_plural
        ? [...Array(nplurals).keys()].some((n) => !e.msgstr[n])
        : !e.msgstr[0];
      if (!(isFuzzy(e) || missing || cfg.reviewAll)) continue;
      const payload = { en: e.msgid };
      if (e.msgctxt) payload.context = e.msgctxt;
      const note = noteOf(e);
      if (note) payload.note = note;
      const file = firstFile(e);
      if (file) payload.file = file;
      payload.audience = audienceOf(e, cfg);
      if (e.msgid_plural) {
        payload.plural = e.msgid_plural;
        payload.forms = nplurals;
      }
      const prev = e.msgid_plural ? e.msgstr.slice(0, nplurals) : e.msgstr[0];
      if (Array.isArray(prev) ? prev.some(Boolean) : prev) payload.previous = prev;
      items.push({ e, payload });
    }
  }

  if (cfg.only) { const re = new RegExp(cfg.only, 'i'); items.splice(0, items.length, ...items.filter((it) => re.test(it.payload.en))); } // test filter
  if (cfg.limit && items.length > cfg.limit) items.length = cfg.limit; // test cap
  const total = items.length;
  log(`${loc.locale}: ${total} entries to ${cfg.reviewAll ? 'review/translate' : 'fill'} (model=${model}, review=${review ? reviewModel : 'off'}, engine=${engine}, nplurals=${nplurals})`);
  let filled = 0;
  let corrected = 0;
  const touched = new Set();
  const tries = cfg.retries || 3;

  // Batches are keyed by the English text, so one batch never holds the same
  // English twice (same text, different msgctxt): the twin goes to a later batch.
  const batches = [];
  for (const it of items) {
    let b = batches.find((x) => x.length < batchSize && !x.some((y) => y.payload.en === it.payload.en));
    if (!b) { b = []; batches.push(b); }
    b.push(it);
  }

  const looseKey = s => s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim();
  // Exact-key lookup, then two forgiving fallbacks (trimmed, then loose punctuation)
  // for a model that does not echo a key byte-for-byte. Keys are the source text, so
  // a fallback can only recover a value, never shift one onto another entry.
  function pick(res, src) {
    if (Object.prototype.hasOwnProperty.call(res, src)) return res[src];
    for (const [k, v] of Object.entries(res)) if (k.trim() === src.trim()) return v;
    for (const [k, v] of Object.entries(res)) if (looseKey(k) === looseKey(src)) return v;
    return undefined;
  }
  // A value is a string (singular) or an array of nplurals strings (plural).
  function apply(it, val) {
    const e = it.e;
    if (e.msgid_plural) {
      if (!Array.isArray(val) || val.length !== nplurals || val.some((v) => !v)) return false;
      e.msgstr = val.map(String);
    } else {
      if (val == null || Array.isArray(val) || !String(val)) return false;
      e.msgstr = [String(val)];
    }
    touched.add(e);
    return true;
  }

  async function call(prompt, m) {
    for (let attempt = 1; attempt <= tries; attempt++) {
      try {
        const res = await translateBatch(prompt, m, engine);
        if (res && typeof res === 'object') return res;
      } catch (err) {
        if (attempt === tries) log(`  ${loc.locale}: model call failed: ${String(err.message).slice(0, 120)}`);
      }
    }
    return null;
  }

  // Translate a chunk; on persistent malformed-JSON failure, split and recurse so a
  // single quote-breaking string is isolated and skipped alone, not its neighbours.
  async function translateChunk(chunk) {
    if (!chunk.length) return [];
    const hits = glossaryHits(gloss, chunk.map((it) => it.payload.en + ' ' + (it.payload.plural || '')));
    const prompt = buildPrompt(cfg, L, chunk.map((it) => it.payload), hits, chunk.some((it) => it.payload.plural) ? pluralRule : '');
    const res = await call(prompt, model);
    if (!res) {
      if (chunk.length === 1) { log(`  ${loc.locale}: skipped 1 string the model could not return`); unsure.add(chunk[0].e); return []; }
      const mid = Math.floor(chunk.length / 2);
      return [...await translateChunk(chunk.slice(0, mid)), ...await translateChunk(chunk.slice(mid))];
    }
    const done = [];
    for (const it of chunk) {
      if (apply(it, pick(res, it.payload.en))) { filled++; done.push(it); }
    }
    return done;
  }

  // Review what was just translated against the same rules and glossary. A reviewer
  // value of "" means "already right"; anything else replaces the translation.
  async function reviewChunk(chunk) {
    if (!review || !chunk.length) return;
    const hits = glossaryHits(gloss, chunk.map((it) => it.payload.en + ' ' + (it.payload.plural || '')));
    const payload = chunk.map((it) => {
      const p = { ...it.payload };
      delete p.previous;
      p.tr = it.e.msgid_plural ? it.e.msgstr.slice(0, nplurals) : it.e.msgstr[0];
      return p;
    });
    const res = await call(buildReviewPrompt(cfg, L, payload, hits), reviewModel);
    // Only reviewed text is written un-fuzzy: a failed review leaves it for the next run.
    if (!res) { chunk.forEach((it) => unsure.add(it.e)); return; }
    for (const it of chunk) {
      const v = pick(res, it.payload.en);
      const empty = v == null || v === '' || (Array.isArray(v) && v.every((x) => !x));
      if (!empty && apply(it, v)) corrected++;
    }
  }

  const hasBadPlaceholders = (e) => {
    if (e.msgid_plural) {
      for (let n = 0; n < nplurals; n++) {
        if (!e.msgstr[n]) continue;
        // Each form must match the singular or the plural source; form 0 of a
        // multi-form language may legitimately read "one item" without %d.
        if (!samePlaceholders(e.msgid, e.msgstr[n]) && !samePlaceholders(e.msgid_plural, e.msgstr[n])) return true;
      }
      return false;
    }
    return !!e.msgstr[0] && !samePlaceholders(e.msgid, e.msgstr[0]);
  };
  const lostBrands = (e) => {
    const hits = new Set();
    droppedTerms(e.msgid, e.msgstr[0], protect).forEach((t) => hits.add(t));
    if (e.msgid_plural) {
      for (let n = 1; n < nplurals; n++) droppedTerms(e.msgid_plural, e.msgstr[n], protect).forEach((t) => hits.add(t));
    }
    return [...hits];
  };
  const badTags = (e) => (e.msgid_plural
    ? e.msgstr.some((s) => s && !sameTags(e.msgid_plural, s) && !sameTags(e.msgid, s))
    : !!e.msgstr[0] && !sameTags(e.msgid, e.msgstr[0]));
  const copied = (e) => copiedEnglish(e.msgid, e.msgstr[0], protect);

  // Glossary consistency: a term in the English whose fixed rendering is not in the
  // translation. Inflected languages change endings, so the stem is compared (first
  // 4 characters, or the whole rendering if shorter). Reported, not fuzzied: a
  // correct inflection must not fall back to English.
  const copies = new Set();
  const fixed = gloss.filter((g) => g.use);
  const glossMiss = (e) => {
    const tr = (e.msgstr || []).join(' ').toLowerCase();
    return fixed
      .filter((g) => termRe(g.term).test(e.msgid) || termRe(`${g.term}s`).test(e.msgid))
      .filter((g) => !tr.includes(g.use.toLowerCase().slice(0, Math.min(4, g.use.length))))
      .map((g) => g.term);
  };

  // Entries this run could not translate or review. Under --review-all they still
  // hold their old text, so they are flagged fuzzy for the next plain run to take.
  const unsure = new Set();

  const persist = () => {
    let fuzzy = 0;
    const brandHits = new Map();
    const glossMisses = new Map();
    copies.clear();
    for (const e of touched) {
      // Unchanged English the gate let through (a capitalised name, or Title Case
      // UI text it cannot tell apart): listed so a person can check them.
      if (!e.msgid_plural && e.msgstr[0] && e.msgstr[0].trim() === e.msgid.trim()) copies.add(e.msgid);
      const brands = lostBrands(e);
      const bad = hasBadPlaceholders(e) || brands.length > 0 || badTags(e) || copied(e);
      setFuzzy(e, bad);
      if (bad) fuzzy++;
      if (brands.length) brandHits.set(e.msgid, brands);
      const miss = glossMiss(e);
      if (miss.length) glossMisses.set(e.msgid, miss);
    }
    for (const e of unsure) {
      if (!isFuzzy(e) && (e.msgstr || []).some(Boolean)) { setFuzzy(e, true); fuzzy++; }
    }
    fs.writeFileSync(poPath, po.compile(data));
    return { fuzzy, brandHits, glossMisses };
  };

  let since = 0;
  let doneCount = 0;
  for (const chunk of batches) {
    const done = await translateChunk(chunk);
    await reviewChunk(done);
    doneCount += chunk.length;
    log(`  ${loc.locale}: ${doneCount}/${total}`);
    since += chunk.length;
    if (since >= (cfg.saveEvery || 200)) { persist(); since = 0; }
  }

  const { fuzzy, brandHits, glossMisses } = persist();
  log(`DONE ${loc.locale}: filled=${filled} reviewed-corrected=${corrected} fuzzy(fallback)=${fuzzy} unconfirmed=${unsure.size} brands-dropped=${brandHits.size} glossary-misses=${glossMisses.size}`);
  for (const [msgid, terms] of [...brandHits].slice(0, 10)) log(`  ! ${loc.locale} dropped ${terms.join('/')}: "${msgid.slice(0, 60)}"`);
  for (const [msgid, terms] of [...glossMisses].slice(0, 15)) log(`  ~ ${loc.locale} glossary ${terms.join('/')}: "${msgid.slice(0, 60)}"`);
  if (glossMisses.size > 15) log(`  ~ ${loc.locale} ... and ${glossMisses.size - 15} more glossary misses`);
  if (copies.size) log(`  = ${loc.locale} kept in English (${copies.size}): ${[...copies].slice(0, 12).map((c) => `"${c.slice(0, 30)}"`).join(', ')}${copies.size > 12 ? ' ...' : ''}`);
  return { total, filled, corrected, fuzzy, brandHits, glossMisses, copies: [...copies] };
}

module.exports = { translatePo, glossaryFor, glossaryHits, audienceOf, copiedEnglish, sameTags, droppedTerms };
