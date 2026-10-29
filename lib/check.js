'use strict';
/**
 * Output-quality check for translated .po files: the mechanical half of the
 * Wbcom translation standard (docs/translation-standard.md). Any agent or person
 * runs the same command and gets the same PASS / REVIEW / FAIL per locale, plus a
 * 40-string sample sheet for the human-judgement half (meaning, kind of text).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { po } = require('gettext-parser');
const { samePlaceholders, npluralsOf } = require('./util');
const { glossaryFor } = require('./translate');

// The form of address a locale must NOT use, keyed by the register the config chose.
// W() builds a Unicode word match (\b fails next to é, ê, ü). German and Italian
// formal forms are capitalised; at the start of a sentence "Sie" / "Ihr" also mean
// "they" / "their", so those are only counted mid-sentence.
const W = (words, flags = 'iu') => new RegExp(`(^|[^\\p{L}])(${words})(?=[^\\p{L}]|$)`, flags);
const MID = (words) => new RegExp(`[\\p{L},;]\\s+(${words})(?=[^\\p{L}]|$)`, 'u');
const AVOID = [
  [/^de_/, W('du'), MID('Sie|Ihnen|Ihr|Ihre|Ihren|Ihrem|Ihres')],
  [/^de_/, W('Sie', 'u'), W('du|dich|dir|dein|deine|deinen|deinem')],
  [/^fr_/, W('tu'), W('vous|votre|vos')],
  [/^fr_/, W('vous'), W('tu|ton|ta|tes|toi')],
  [/^es_/, W('tú'), W('usted|ustedes')],
  [/^nl_/, W('je'), W('u|uw')],
  [/^nl_/, W('u'), W('je|jouw|jij')],
  [/^it_/, W('tu'), MID('Lei|Suo|Sua|Suoi')],
  [/^pt_/, W('você'), W('tu|teu|tua|vós')],
];
// Compare without case or accents: "denúncia" uses the glossary's "denunciar".
const plain = (s) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
// A multi-word rendering is matched on its longest word ("mise en sourdine" ->
// "sourdine"), cut to a stem that survives endings ("тема" -> "тем" matches "темы").
// " / " separates alternatives, e.g. a noun and a verb: "жалоба / пожаловаться".
const stem = (w) => {
  const k = plain(w).split(/\s+/).sort((a, b) => b.length - a.length)[0];
  return k.length <= 2 ? k : k.slice(0, Math.min(4, k.length - 1));
};
// Chinese, Japanese and Korean have no spaces and reorder compounds ("表情回应" /
// "回应表情符号"), so any two-character piece of the rendering counts.
const cjk = (w) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(w);
const usesTerm = (tr, rendering) => rendering.split(' / ').some((r) => {
  if (!cjk(r) || r.length <= 2) return plain(tr).includes(stem(r));
  for (let i = 0; i < r.length - 1; i++) if (tr.includes(r.slice(i, i + 2))) return true;
  return false;
});
const word = (t) => new RegExp(`(^|[^\\p{L}_{/-])${t}(s|es)?(?=[^\\p{L}_}/-]|$)`, 'iu');
// Tokens, placeholders and identifiers are not prose: "{space_name}", "target_space_id".
// Quoted code values ("reply") and domains (reply.example.com) are not prose either.
const prose = (s) => s.replace(/\{[^}]*\}|%(\d+\$)?[a-z]|\S*_\S*|["'][a-z_-]+["']|\S+\.[a-z]{2,}\S*/gi, ' ');

/** Deterministic pick so two runs (or two agents) review the same sample. */
function sample(list, n, seed) {
  let h = 0;
  for (const c of seed) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    h = (h * 1103515245 + 12345) >>> 0;
    const j = h % (i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, n);
}

function corePo(dir, locale) {
  if (!dir) return null;
  const map = new Map();
  for (const f of [`${locale}.po`, `admin-${locale}.po`]) {
    const p = path.join(dir, f);
    if (!fs.existsSync(p)) continue;
    const d = po.parse(fs.readFileSync(p)).translations;
    for (const ctx of Object.keys(d)) for (const k of Object.keys(d[ctx])) {
      if (k && d[ctx][k].msgstr[0]) map.set(`${ctx}\u0004${k}`, d[ctx][k].msgstr[0]);
    }
  }
  return map.size ? map : null;
}

function checkPo(poPath, loc, cfg, opts = {}) {
  const data = po.parse(fs.readFileSync(poPath));
  const nplurals = npluralsOf(data.headers['plural-forms'] || data.headers['Plural-Forms'] || '');
  const entries = [];
  for (const ctx of Object.keys(data.translations)) {
    for (const k of Object.keys(data.translations[ctx])) if (k) entries.push(data.translations[ctx][k]);
  }
  const fuzzy = (e) => /\bfuzzy\b/.test((e.comments && e.comments.flag) || '');
  const done = entries.filter((e) => !fuzzy(e) && e.msgstr.some(Boolean));
  const r = { locale: loc.locale, file: poPath, total: entries.length, done: done.length, checks: [] };
  const add = (name, status, detail, samples = []) => r.checks.push({ name, status, detail, samples });

  // 1. Coverage (translated and not fuzzy).
  const pct = entries.length ? (100 * done.length) / entries.length : 0;
  add('coverage', pct >= 95 ? 'PASS' : 'FAIL', `${pct.toFixed(1)}% (${done.length}/${entries.length}, ${entries.filter(fuzzy).length} fuzzy)`);

  // 2. Placeholders and plural forms on everything that ships.
  const badPh = [], badPl = [];
  for (const e of done) {
    if (e.msgid_plural) {
      if (e.msgstr.length < nplurals || e.msgstr.slice(0, nplurals).some((s) => !s)) badPl.push(e.msgid);
      else if (e.msgstr.slice(0, nplurals).some((s) => !samePlaceholders(e.msgid, s) && !samePlaceholders(e.msgid_plural, s))) badPh.push(e.msgid);
    } else if (!samePlaceholders(e.msgid, e.msgstr[0])) badPh.push(e.msgid);
  }
  add('placeholders', badPh.length ? 'FAIL' : 'PASS', `${badPh.length} mismatched`, badPh.slice(0, 5));
  add('plural-forms', badPl.length ? 'FAIL' : 'PASS', `${badPl.length} missing a form (nplurals=${nplurals})`, badPl.slice(0, 5));

  // 3. Glossary consistency: the share of strings using a term that lack its rendering.
  // Inflection and homonyms ("Code block" is not a moderation block) hide correct uses,
  // so a term is REVIEW above 10% and FAIL only above 30% across 10 or more strings.
  const terms = glossaryFor(cfg, loc).filter((g) => g.use);
  const termRows = [];
  for (const g of terms) {
    const uses = done.filter((e) => word(g.term).test(prose(e.msgid)));
    if (uses.length < 5) continue;
    const miss = uses.filter((e) => !usesTerm(e.msgstr.join(' '), g.use));
    const rate = miss.length / uses.length;
    if (rate > 0.1) termRows.push({ term: g.term, use: g.use, rate, n: uses.length, fail: rate > 0.3 && uses.length >= 10, ex: miss.slice(0, 3).map((e) => `${e.msgid} => ${e.msgstr[0]}`) });
  }
  add('glossary', termRows.some((t) => t.fail) ? 'FAIL' : termRows.length ? 'REVIEW' : 'PASS',
    termRows.length ? termRows.map((t) => `${t.term}->${t.use} missing in ${Math.round(t.rate * 100)}% of ${t.n}`).join('; ') : 'every term used consistently',
    termRows.flatMap((t) => t.ex));

  // 4. Register: the form of address the config did not choose.
  const rule = AVOID.find(([re, chosen]) => re.test(loc.locale) && chosen.test(loc.register || ''));
  if (rule) {
    const hits = done.filter((e) => rule[2].test(e.msgstr.join(' ')));
    add('register', hits.length > 2 ? 'FAIL' : hits.length ? 'REVIEW' : 'PASS', `${hits.length} strings use the other form of address (${loc.register})`,
      hits.slice(0, 5).map((e) => `${e.msgid} => ${e.msgstr[0]}`));
  } else {
    add('register', 'SKIP', `no rule for ${loc.locale} / "${loc.register || 'unset'}"`);
  }

  // 5. Strings WordPress core also translates must match core.
  const core = corePo(opts.core, loc.locale);
  if (core) {
    const diff = done.filter((e) => {
      const c = core.get(`${e.msgctxt || ''}\u0004${e.msgid}`);
      return c && !e.msgid_plural && c !== e.msgstr[0];
    });
    add('core-words', diff.length ? 'REVIEW' : 'PASS', `${diff.length} strings differ from WordPress core`,
      diff.slice(0, 8).map((e) => `${e.msgid} => ${e.msgstr[0]} (core: ${core.get(`${e.msgctxt || ''}\u0004${e.msgid}`)})`));
  } else {
    add('core-words', 'SKIP', opts.core ? `no core .po for ${loc.locale} in ${opts.core}` : 'pass --core=<wp-content/languages> to compare');
  }

  // 6. Sample sheet for the human read: 40 strings, same pick every run.
  // Default: one fresh private temp dir per run (mkdtemp: 0700, random name), never
  // a fixed shared path another user could pre-create or symlink.
  if (!opts.out) opts.out = fs.mkdtempSync(path.join(os.tmpdir(), `wbcom-i18n-check-${cfg.domain || 'plugin'}-`));
  const outDir = opts.out;
  fs.mkdirSync(outDir, { recursive: true });
  const pick = sample(done, 40, `${cfg.domain}${loc.locale}`);
  const cell = (s) => String(s || '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const sheet = [
    `# ${cfg.domain} ${loc.locale} sample read (${loc.register || 'register unset'})`,
    '',
    'Mark each row OK or WRONG with a reason: meaning, term, kind (button/heading/chip/message), register, length. More than 2 WRONG: run another pass.',
    '',
    '| # | English | Note / context | File | Translation | OK / WRONG | Reason |',
    '|---|---|---|---|---|---|---|',
    ...pick.map((e, i) => `| ${i + 1} | ${cell(e.msgid)} | ${cell([e.msgctxt, e.comments && e.comments.extracted].filter(Boolean).join(' / '))} | ${cell(((e.comments && e.comments.reference) || '').split(/\s+/)[0])} | ${cell(e.msgstr.join(' / '))} |  |  |`),
  ].join('\n');
  r.sheet = path.join(outDir, `sample-${loc.locale}.md`);
  fs.writeFileSync(r.sheet, sheet + '\n', { flag: 'w', mode: 0o600 });

  r.status = r.checks.some((c) => c.status === 'FAIL') ? 'FAIL' : r.checks.some((c) => c.status === 'REVIEW') ? 'REVIEW' : 'PASS';
  return r;
}

module.exports = { checkPo, sample, AVOID };
