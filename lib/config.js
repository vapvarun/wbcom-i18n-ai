'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  engine: 'claude',     // 'claude' (CLI, no key) | 'api' (ANTHROPIC_API_KEY)
  model: 'haiku',
  batch: 80,
  languagesDir: 'languages',
  makeJson: true,       // also emit .json for block/JS i18n
  protect: ['Jetonomy', 'Pro', 'WordPress', 'BuddyPress', 'REST', 'API', 'URL', 'CSV', 'AI', 'HTML', 'CSS'],
  glossary: {},
  locales: [],
};

/** Load .wbcom-i18n.json from cwd (plugin root), merge defaults, resolve paths. */
function loadConfig(cwd = process.cwd(), file = '.wbcom-i18n.json') {
  const p = path.resolve(cwd, file);
  if (!fs.existsSync(p)) throw new Error(`Config not found: ${p}`);
  const cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
  cfg.cwd = cwd;
  if (!cfg.domain) throw new Error('config.domain is required (the text domain / slug)');
  cfg.languagesDir = path.resolve(cwd, cfg.languagesDir);
  cfg.potFile = path.resolve(cwd, cfg.potFile || path.join('languages', `${cfg.domain}.pot`));
  cfg.locales = cfg.locales.map((l) => ({
    register: 'neutral', ...l,
    poFile: path.join(cfg.languagesDir, `${cfg.domain}-${l.locale}.po`),
    moFile: path.join(cfg.languagesDir, `${cfg.domain}-${l.locale}.mo`),
  }));
  return cfg;
}

module.exports = { loadConfig, DEFAULTS };
