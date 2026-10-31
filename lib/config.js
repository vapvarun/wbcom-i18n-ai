'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  type: 'plugin',       // 'plugin' | 'theme' — decides the locale filename convention
  engine: 'claude',     // 'claude' (CLI, no key) | 'api' (ANTHROPIC_API_KEY)
  model: 'haiku',        // Haiku 5.5 with context + glossary matched Sonnet in tests (2026-10-29)
  review: true,          // second pass checks each translation against the rules + glossary
  batch: 40,
  languagesDir: 'languages',
  potExclude: 'dist,build,libs', // added to make-pot's own excludes (vendor, node_modules, tests, *.min.js)
  makeJson: true,       // also emit .json for block/JS i18n
  makePhp: true,        // also emit .l10n.php — WordPress 6.5+ loads it in preference to the .mo
  protect: ['Jetonomy', 'Pro', 'WordPress', 'BuddyPress', 'REST', 'API', 'URL', 'CSV', 'HTML', 'CSS'], // not AI: fr/es/it/pt write IA, ru ИИ
  glossary: {},          // { term: { meaning, <locale>: rendering } } or legacy { term: rendering }
  glossaryFile: '',      // optional JSON { brief, glossary } shared by a plugin family
  brief: '',             // one or two sentences: what the product is and who uses it
  audience: [],          // optional [regex-on-source-file, audience] pairs
  locales: [],
};

/**
 * WordPress looks for a different filename depending on what is being translated:
 *   plugin -> languages/{domain}-{locale}.mo   (load_plugin_textdomain)
 *   theme  -> languages/{locale}.mo            (load_theme_textdomain)
 * Emitting the plugin form for a theme produces files WordPress silently never
 * loads, so `type` is not cosmetic — get it wrong and the whole run is dead weight.
 */
function localeFileBase(cfg, locale) {
  return cfg.type === 'theme' ? locale : `${cfg.domain}-${locale}`;
}

/** Realpath of p, or of its nearest existing parent for a file not created yet. */
function realish(p) {
  if (fs.existsSync(p)) return fs.realpathSync(p);
  // existsSync follows links, so a dangling one looks absent, yet writing through it lands at its target.
  let link = false;
  try { link = fs.lstatSync(p).isSymbolicLink(); } catch { /* nothing there yet */ }
  if (link) throw new Error(`dangling symlink: ${p}`);
  return path.join(realish(path.dirname(p)), path.basename(p));
}

/** Load .wbcom-i18n.json from cwd (plugin/theme root), merge defaults, resolve paths. */
function loadConfig(cwd = process.cwd(), file = '.wbcom-i18n.json') {
  const p = path.resolve(cwd, file);
  if (!fs.existsSync(p)) throw new Error(`Config not found: ${p}`);
  const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  cfg.cwd = cwd;
  if (!cfg.domain) throw new Error('config.domain is required (the text domain / slug)');
  if (!['plugin', 'theme'].includes(cfg.type)) {
    throw new Error(`config.type must be "plugin" or "theme" (got "${cfg.type}")`);
  }
  // A family (Free + Pro) shares one glossary: glossaryFile points at it, so the
  // two never drift into different words for the same thing.
  if (cfg.glossaryFile) {
    const g = path.resolve(cwd, cfg.glossaryFile);
    if (!fs.existsSync(g)) throw new Error(`glossaryFile not found: ${g}`);
    cfg.glossary = { ...JSON.parse(fs.readFileSync(g, 'utf8')).glossary, ...(cfg.glossary || {}) };
    if (!cfg.brief) cfg.brief = JSON.parse(fs.readFileSync(g, 'utf8')).brief || '';
  }
  cfg.languagesDir = path.resolve(cwd, cfg.languagesDir);
  cfg.potFile = path.resolve(cwd, cfg.potFile || path.join('languages', `${cfg.domain}.pot`));
  // sync overwrites these, so a config cannot point them outside the repo.
  const inside = (p) => { const r = path.relative(fs.realpathSync(cwd), realish(p)); return r && !r.startsWith('..') && !path.isAbsolute(r); };
  if (!inside(cfg.languagesDir)) throw new Error(`languagesDir must be inside the repo: ${cfg.languagesDir}`);
  if (!inside(cfg.potFile) || !cfg.potFile.endsWith('.pot')) throw new Error(`potFile must be a .pot inside the repo: ${cfg.potFile}`);
  cfg.locales = cfg.locales.map((l) => {
    const base = localeFileBase(cfg, l.locale);
    return {
      register: 'neutral', ...l,
      poFile: path.join(cfg.languagesDir, `${base}.po`),
      moFile: path.join(cfg.languagesDir, `${base}.mo`),
      phpFile: path.join(cfg.languagesDir, `${base}.l10n.php`),
    };
  });
  return cfg;
}

module.exports = { loadConfig, DEFAULTS };
