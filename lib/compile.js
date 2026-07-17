'use strict';
const { execFileSync } = require('child_process');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Compile each locale .po -> .mo (with `-c` = the crash-safety check), then emit
 * the JSON files block/JS i18n needs (wp i18n make-json). msgfmt -c fails loudly
 * on any format/placeholder error a fuzzy flag didn't already neutralise.
 *
 * WordPress 6.5+ loads a sibling `{base}.l10n.php` in PREFERENCE to the .mo. If one
 * already exists and we refresh only the .mo, every new translation is invisible on
 * the site while the stale .l10n.php keeps serving - so regenerate it too.
 */
function compileLocales(cfg, log = () => {}) {
  for (const loc of cfg.locales) {
    sh('msgfmt', ['-c', '-o', loc.moFile, loc.poFile]);
    log(`  compile ${loc.locale}: ${loc.moFile}`);
  }
  if (cfg.makeJson) {
    try {
      sh('wp', ['i18n', 'make-json', cfg.languagesDir, '--no-purge', `--domain=${cfg.domain}`]);
      log('  make-json: emitted JS/block translations');
    } catch (e) {
      log(`  make-json skipped (wp-cli i18n unavailable): ${String(e.message).split('\n')[0]}`);
    }
  }
  if (cfg.makePhp) {
    try {
      sh('wp', ['i18n', 'make-php', cfg.languagesDir]);
      log('  make-php: refreshed .l10n.php (WP 6.5+ reads these before the .mo)');
    } catch (e) {
      log(`  make-php skipped (wp-cli i18n unavailable): ${String(e.message).split('\n')[0]}`);
    }
  }
}

module.exports = { compileLocales };
