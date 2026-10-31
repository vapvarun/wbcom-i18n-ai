'use strict';
/**
 * The translation template (.pot) built from the plugin's code. `sync` rebuilds it
 * and `check` compares against a fresh build, both through makePot, so the two can
 * never use different arguments. A template that lags the code hides new strings
 * from every language while coverage still reads 100%.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { po } = require('gettext-parser');

/** Returns make-pot's audit warnings (duplicate or missing translator comments). */
function makePot(cfg, out) {
  const args = ['i18n', 'make-pot', cfg.cwd, out, `--slug=${cfg.domain}`, `--domain=${cfg.domain}`];
  if (cfg.potExclude) args.push(`--exclude=${cfg.potExclude}`);
  // WP-CLI loads wp-cli.yml from its working directory and every parent, and that
  // file can require PHP. So run from the filesystem root, which has no parents and
  // other users cannot write to, not the repo or a shared temp dir.
  const r = spawnSync(process.env.WP_CLI || 'wp', args, { cwd: path.parse(cfg.cwd).root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) {
    throw new Error(`wp i18n make-pot failed: ${r.error ? r.error.message : String(r.stderr).trim().split('\n').pop()}`);
  }
  return `${r.stdout}\n${r.stderr}`.split('\n').filter((l) => /^Warning: The string/.test(l));
}

function potKeys(file) {
  const data = po.parse(fs.readFileSync(file));
  const keys = new Map();
  for (const ctx of Object.keys(data.translations)) {
    for (const id of Object.keys(data.translations[ctx])) if (id) keys.set(`${ctx}\u0004${id}`, id);
  }
  return keys;
}

/** Compares the committed template with a fresh build: the `template` check's result. */
function templateCheck(cfg, run = makePot) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wbcom-i18n-pot-'));
  try {
    const fresh = path.join(dir, 'fresh.pot');
    try {
      run(cfg, fresh);
    } catch (e) {
      return { status: 'REVIEW', detail: `could not compare with the code (${e.message})`, samples: [] };
    }
    if (!fs.existsSync(cfg.potFile)) return { status: 'FAIL', detail: 'no template: run wbcom-i18n sync', samples: [] };
    const code = potKeys(fresh);
    const committed = potKeys(cfg.potFile);
    const missing = [...code.keys()].filter((k) => !committed.has(k)).map((k) => code.get(k));
    const gone = [...committed.keys()].filter((k) => !code.has(k)).map((k) => committed.get(k));
    if (missing.length) {
      return { status: 'FAIL', detail: `${missing.length} strings in the code are not in the template: run wbcom-i18n sync`, samples: missing.slice(0, 5) };
    }
    if (gone.length) {
      return { status: 'REVIEW', detail: `${gone.length} template strings are no longer in the code: run wbcom-i18n sync`, samples: gone.slice(0, 5) };
    }
    return { status: 'PASS', detail: `matches the code (${code.size} strings)`, samples: [] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { makePot, templateCheck };
