#!/usr/bin/env node
'use strict';
const { loadConfig } = require('../lib/config');
const { syncLocales } = require('../lib/sync');
const { translatePo } = require('../lib/translate');
const { compileLocales } = require('../lib/compile');
const { checkPo } = require('../lib/check');
const { makePot, templateCheck } = require('../lib/pot');
const fs = require('fs');

const log = (m) => console.log(m);

function parseArgs(argv) {
  const a = { _: [] };
  for (const t of argv) {
    if (t.startsWith('--')) { const [k, v] = t.slice(2).split('='); a[k] = v === undefined ? true : v; }
    else a._.push(t);
  }
  return a;
}

const USAGE = `wbcom-i18n <command> [options]
  Commands: sync (rebuilds the template, then merges it) | translate | compile | all (default) | check
  Options:
    --config=<file>     config file (default .wbcom-i18n.json)
    --locales=de_DE,..  only these locales
    --engine=claude|cursor|api  engine (claude = Claude subscription, cursor = Cursor subscription)
    --model=haiku|...   override the translate model (default haiku)
    --review-all        re-review every entry, not only empty/fuzzy ones; the
                        current translation is sent as a starting point
    --no-review         skip the review step (not recommended)
    --limit=<n>         translate at most n entries per locale (testing)
    --only=<regex>      only entries whose English matches (testing)
    --core=<dir>        check: WordPress core .po dir (wp-content/languages) to compare core words
    --out=<dir>         check: where the sample sheets go (default: system temp dir)
    --json              check: print the result as JSON
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) { process.stdout.write(USAGE); return; }
  const cmd = args._[0] || 'all';
  const cfg = loadConfig(process.cwd(), typeof args.config === 'string' ? args.config : '.wbcom-i18n.json');
  if (args.locales) { const want = String(args.locales).split(','); cfg.locales = cfg.locales.filter((l) => want.includes(l.locale)); }
  if (typeof args.engine === 'string') cfg.engine = args.engine;
  if (typeof args.model === 'string') cfg.model = args.model;
  if (args.limit) cfg.limit = parseInt(String(args.limit), 10);
  if (args['review-all']) cfg.reviewAll = true;
  if (typeof args.only === 'string') cfg.only = args.only;
  if (args['no-review']) cfg.review = false;
  if (!cfg.locales.length) throw new Error('no locales selected');

  if (cmd === 'sync' || cmd === 'all') {
    log('▶ template');
    const warnings = makePot(cfg, cfg.potFile);
    log(`  rebuilt ${cfg.potFile} (${warnings.length} translator-comment warnings)`);
    for (const w of warnings) log(`  ${w}`);
    log('▶ sync');
    syncLocales(cfg, log);
  }
  if (cmd === 'translate' || cmd === 'all') {
    log('▶ translate');
    for (const loc of cfg.locales) await translatePo(loc.poFile, loc, cfg, log);
  }
  if (cmd === 'compile' || cmd === 'all') { log('▶ compile'); compileLocales(cfg, log); }
  if (cmd === 'check') {
    const opts = { core: typeof args.core === 'string' ? args.core : '', out: typeof args.out === 'string' ? args.out : '', template: templateCheck(cfg) };
    const results = cfg.locales.filter((l) => fs.existsSync(l.poFile)).map((l) => checkPo(l.poFile, l, cfg, opts));
    if (args.json) { process.stdout.write(JSON.stringify(results, null, 2) + '\n'); }
    else {
      for (const r of results) {
        log(`${r.status.padEnd(6)} ${r.locale}`);
        for (const c of r.checks) {
          log(`  ${c.status.padEnd(6)} ${c.name.padEnd(13)} ${c.detail}`);
          for (const x of c.samples) log(`         - ${String(x).slice(0, 140)}`);
        }
        log(`  sample sheet: ${r.sheet}`);
      }
    }
    if (results.some((r) => r.status === 'FAIL')) process.exitCode = 1;
    return;
  }
  log('✓ done');
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
