'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Bring every locale .po in lockstep with the current .pot.
 * - missing .po  -> msginit (fresh, all untranslated)
 * - existing .po -> msgmerge (NEW strings appear untranslated, CHANGED ones fuzzy)
 * This is the "sync new strings" step: only new/changed entries become work for
 * the translate step; existing translations are preserved.
 */
function syncLocales(cfg, log = () => {}) {
  if (!fs.existsSync(cfg.potFile)) {
    throw new Error(`POT not found: ${cfg.potFile} (run 'grunt makepot' / 'wp i18n make-pot' first)`);
  }
  for (const loc of cfg.locales) {
    if (fs.existsSync(loc.poFile)) {
      sh('msgmerge', ['--update', '--backup=none', '--no-fuzzy-matching', loc.poFile, cfg.potFile]);
      log(`  sync ${loc.locale}: merged new/changed strings`);
    } else {
      sh('msginit', ['--no-translator', `--locale=${loc.locale}`, `--input=${cfg.potFile}`, `--output=${loc.poFile}`]);
      log(`  sync ${loc.locale}: created ${loc.poFile}`);
    }
  }
}

module.exports = { syncLocales };
