'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPo, AVOID } = require('../lib/check');
const { templateCheck, makePot } = require('../lib/pot');
const { loadConfig } = require('../lib/config');

const po = (rows) => [
  'msgid ""', 'msgstr ""', '"Plural-Forms: nplurals=2; plural=(n != 1);\\n"', '',
  ...rows.flatMap(([id, str, flag]) => [...(flag ? [`#, ${flag}`] : []), `msgid "${id}"`, `msgstr "${str}"`, '']),
].join('\n');

test('check: coverage, placeholders, glossary and register', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chk-'));
  const file = path.join(dir, 'x-de_DE.po');
  const rows = [['Reply %s', 'Antwort %s'], ['Delete reply', 'Antwort löschen'], ['Edit reply', 'Beitrag bearbeiten'],
    ['Your reply', 'Deine Antwort'], ['A reply', 'Eine Antwort'], ['Save', 'Speichern'], ['Hello', 'Hallo', 'fuzzy']];
  fs.writeFileSync(file, po(rows));
  const cfg = { domain: 'x', glossary: { reply: { de_DE: 'Antwort' } } };
  const r = checkPo(file, { locale: 'de_DE', register: 'informal (du)' }, cfg, { out: dir });
  const c = Object.fromEntries(r.checks.map((x) => [x.name, x.status]));
  assert.equal(c.coverage, 'FAIL');          // 6/7 = 85.7%
  assert.equal(c.placeholders, 'PASS');
  assert.equal(c.glossary, 'REVIEW');        // 1 of 5 "reply" strings lacks Antwort
  assert.equal(c.register, 'PASS');
  assert.ok(fs.existsSync(r.sheet));
});

test('check: register ignores sentence-initial Sie/Ihr (they/their)', () => {
  const de = AVOID.find(([re, chosen]) => re.test('de_DE') && chosen.test('informal (du)'))[2];
  assert.equal(de.test('Ihr Inhalt wurde gemeldet'), false);
  assert.equal(de.test('Hier können Sie das ändern'), true);
});

test('template: fails when the code has strings the template lacks', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  const potFile = path.join(dir, 'x.pot');
  const build = (ids) => (_cfg, out) => fs.writeFileSync(out, po(ids.map((id) => [id, ''])));
  fs.writeFileSync(potFile, po([['Old', ''], ['Same', '']]));
  const cfg = { domain: 'x', potFile };

  assert.equal(templateCheck(cfg, build(['Same', 'Old'])).status, 'PASS');
  const missing = templateCheck(cfg, build(['Same', 'Old', 'New']));
  assert.equal(missing.status, 'FAIL');
  assert.deepEqual(missing.samples, ['New']);
  assert.equal(templateCheck(cfg, build(['Same'])).status, 'REVIEW');
  assert.equal(templateCheck(cfg, () => { throw new Error('no wp'); }).status, 'REVIEW');
});

test('check: the template result is reported and fails the locale', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpl-'));
  const file = path.join(dir, 'x-de_DE.po');
  fs.writeFileSync(file, po([['Save', 'Speichern']]));
  const template = { status: 'FAIL', detail: '1 strings', samples: ['New'] };
  const r = checkPo(file, { locale: 'de_DE' }, { domain: 'x' }, { out: dir, template });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.checks[0].name, 'template');
});

test('config: the template and languages folder must stay inside the repo', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')));
  const load = (c) => { fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ domain: 'x', ...c })); return () => loadConfig(dir, 'c.json'); };
  assert.ok(load({})().potFile.endsWith('languages/x.pot'));
  assert.throws(load({ potFile: '../evil.pot' }), /potFile/);
  assert.throws(load({ potFile: 'languages/x.php' }), /potFile/);
  assert.throws(load({ languagesDir: '../elsewhere' }), /languagesDir/);
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'out'));
  assert.throws(load({ potFile: 'out/x.pot' }), /potFile/);
  fs.symlinkSync(path.join(os.tmpdir(), 'wbcom-absent.pot'), path.join(dir, 'dangling.pot'));
  assert.throws(load({ potFile: 'dangling.pot' }), /dangling/);
  assert.throws(load({ locales: [{ locale: '/../../../evil' }] }), /locale file/);
  fs.mkdirSync(path.join(dir, 'languages'));
  fs.symlinkSync(os.tmpdir(), path.join(dir, 'languages', 'x-de_DE.mo'));
  assert.throws(load({ locales: [{ locale: 'de_DE' }] }), /locale file/);
});

test('makePot: wp runs from the filesystem root, so no wp-cli.yml is loaded', () => {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wp-')));
  const log = path.join(dir, 'cwd.txt');
  const fake = path.join(dir, 'fake-wp');
  fs.writeFileSync(fake, `#!/bin/sh\npwd > "${log}"\n`, { mode: 0o755 });
  process.env.WP_CLI = fake;
  try { makePot({ domain: 'x', cwd: dir }, path.join(dir, 'o.pot')); } finally { delete process.env.WP_CLI; }
  assert.equal(fs.readFileSync(log, 'utf8').trim(), path.parse(dir).root);
});
