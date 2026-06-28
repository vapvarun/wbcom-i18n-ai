#!/usr/bin/env node
'use strict';
const { loadConfig } = require('../lib/config');
const { syncLocales } = require('../lib/sync');
const { translatePo } = require('../lib/translate');
const { compileLocales } = require('../lib/compile');

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
  Commands: sync | translate | compile | all (default)
  Options:
    --config=<file>     config file (default .wbcom-i18n.json)
    --locales=de_DE,..  only these locales
    --engine=claude|api override engine
    --model=haiku|...   override default model
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
  if (!cfg.locales.length) throw new Error('no locales selected');

  if (cmd === 'sync' || cmd === 'all') { log('▶ sync'); syncLocales(cfg, log); }
  if (cmd === 'translate' || cmd === 'all') {
    log('▶ translate');
    for (const loc of cfg.locales) await translatePo(loc.poFile, loc, cfg, log);
  }
  if (cmd === 'compile' || cmd === 'all') { log('▶ compile'); compileLocales(cfg, log); }
  log('✓ done');
}
main().catch((e) => { console.error('ERROR:', e.message); process.exit(1); });
