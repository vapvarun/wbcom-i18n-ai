'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { checkPo, AVOID } = require('../lib/check');

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
