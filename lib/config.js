'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  type: 'plugin',       // 'plugin' | 'theme' — decides the locale filename convention
  engine: 'claude',     // 'claude' (CLI, no key) | 'api' (ANTHROPIC_API_KEY)
  model: 'haiku',
  batch: 80,
  languagesDir: 'languages',
  makeJson: true,       // also emit .json for block/JS i18n
  makePhp: true,        // also emit .l10n.php — WordPress 6.5+ loads it in preference to the .mo
  protect: ['Jetonomy', 'Pro', 'WordPress', 'BuddyPress', 'REST', 'API', 'URL', 'CSV', 'AI', 'HTML', 'CSS'],
  glossary: {},
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
  cfg.languagesDir = path.resolve(cwd, cfg.languagesDir);
  cfg.potFile = path.resolve(cwd, cfg.potFile || path.join('languages', `${cfg.domain}.pot`));
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
