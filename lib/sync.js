'use strict';
const fs = require('fs');
const { execFileSync } = require('child_process');

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Plural rules for locales msginit does not know. `wp i18n make-pot` writes a
 * language-neutral .pot with no Plural-Forms, and msginit fills one in from its own
 * tables — but it has no entry for Arabic, so ar.po comes out with none at all.
 *
 * That is not cosmetic. Without the header:
 *   - msgfmt -c FAILS ("catalog has plural form translations ... but header entry
 *     lacks a plural=EXPRESSION attribute"), so no .mo is produced and compile dies
 *     before make-json/make-php ever run — taking every other locale's .l10n.php
 *     down with it;
 *   - and this tool reads nplurals as 2, so an Arabic plural gets 2 of its 6 forms
 *     filled and the rest ship empty.
 *
 * Rules are the CLDR/WordPress ones. Add locales here as they are adopted.
 */
const PLURAL_FORMS = {
  ar: 'nplurals=6; plural=(n==0 ? 0 : n==1 ? 1 : n==2 ? 2 : n%100>=3 && n%100<=10 ? 3 : n%100>=11 && n%100<=99 ? 4 : 5);',
  he_IL: 'nplurals=4; plural=(n==1 ? 0 : n==2 ? 1 : n>10 && n%10==0 ? 2 : 3);',
  ru_RU: 'nplurals=3; plural=(n%10==1 && n%100!=11 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  pl_PL: 'nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<12 || n%100>14) ? 1 : 2);',
  cs_CZ: 'nplurals=3; plural=(n==1) ? 0 : (n>=2 && n<=4) ? 1 : 2;',
  ja: 'nplurals=1; plural=0;',
  ko_KR: 'nplurals=1; plural=0;',
  zh_CN: 'nplurals=1; plural=0;',
  zh_TW: 'nplurals=1; plural=0;',
  tr_TR: 'nplurals=2; plural=(n > 1);',
};

/** Ensure the .po header carries Language and Plural-Forms; msginit omits some. */
function ensureHeaders(poFile, locale, log = () => {}) {
  let txt = fs.readFileSync(poFile, 'utf8');
  const header = txt.slice(0, txt.indexOf('\n\n') + 1 || txt.length);
  let changed = false;

  if (!/"Language:/.test(header)) {
    txt = txt.replace(/("MIME-Version: [^"]*\\n"\n)/, `"Language: ${locale}\\n"\n$1`);
    changed = true;
  }
  if (!/"Plural-Forms:/.test(header)) {
    const rule = PLURAL_FORMS[locale] || PLURAL_FORMS[locale.split('_')[0]];
    if (rule) {
      txt = txt.replace(/("Content-Transfer-Encoding: [^"]*\\n"\n)/, `$1"Plural-Forms: ${rule}\\n"\n`);
      changed = true;
      log(`  sync ${locale}: added missing Plural-Forms (msginit has no rule for this locale)`);
    } else {
      log(`  sync ${locale}: WARNING no Plural-Forms and no fallback rule — plurals will be wrong`);
    }
  }
  if (changed) fs.writeFileSync(poFile, txt);
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
    ensureHeaders(loc.poFile, loc.locale, log);
  }
}

module.exports = { syncLocales };
