'use strict';
// node --test. Covers the checks that decide what ships: the glossary per locale,
// audience from the source file, copied English, HTML tags, glossary hits.
const test = require('node:test');
const assert = require('node:assert');
const { glossaryFor, glossaryHits, audienceOf, copiedEnglish, sameTags } = require('../lib/translate');

test('rich glossary gives each locale its own rendering; flat glossary still works', () => {
  const cfg = { glossary: { space: { meaning: 'a community area', de_DE: 'Bereich', fr_FR: 'espace' }, Badge: 'Abzeichen' } };
  const de = glossaryFor(cfg, { locale: 'de_DE' });
  assert.deepStrictEqual(de.find((g) => g.term === 'space'), { term: 'space', meaning: 'a community area', use: 'Bereich' });
  assert.strictEqual(glossaryFor(cfg, { locale: 'fr_FR' }).find((g) => g.term === 'space').use, 'espace');
  assert.strictEqual(glossaryFor(cfg, { locale: 'ja' }).find((g) => g.term === 'space').use, '', 'undecided locale');
  assert.strictEqual(de.find((g) => g.term === 'Badge').use, 'Abzeichen');
});

test('only glossary terms present in the batch are sent (word match, simple plurals)', () => {
  const gloss = [{ term: 'space' }, { term: 'badge' }, { term: 'trust level' }];
  const hits = glossaryHits(gloss, ['Leave this space?', 'All Trust Levels']).map((g) => g.term);
  assert.deepStrictEqual(hits, ['space', 'trust level']);
  assert.deepStrictEqual(glossaryHits(gloss, ['Workspace settings']).map((g) => g.term), [], 'no match inside a word');
});

test('audience comes from the source file', () => {
  const at = (ref) => audienceOf({ comments: { reference: ref } }, {});
  assert.match(at('includes/admin/views/settings.php:12'), /^admin/);
  assert.strictEqual(at('templates/emails/digest.php:4'), 'email');
  assert.match(at('templates/views/space.php:88'), /^member/);
  assert.strictEqual(audienceOf({ comments: { reference: 'x/y.php:1' } }, { audience: [['x/', 'custom']] }), 'custom');
});

test('copied English is caught, brand-only strings are not', () => {
  // Title Case cannot be told from a product name, so it is reported, not fuzzied.
  assert.strictEqual(copiedEnglish('Save Changes', 'Save Changes', ['Jetonomy']), false);
  assert.strictEqual(copiedEnglish('Jetonomy Pro', 'Jetonomy Pro', ['Jetonomy', 'Pro']), false);
  assert.strictEqual(copiedEnglish('%s', '%s', []), false);
  assert.strictEqual(copiedEnglish('Save', 'Speichern', []), false);
  assert.strictEqual(copiedEnglish('Tutor LMS', 'Tutor LMS', []), false, 'a third-party product name');
  assert.strictEqual(copiedEnglish('https://wbcomdesigns.com/', 'https://wbcomdesigns.com/', []), false, 'an address');
  assert.strictEqual(copiedEnglish('Save changes', 'Save changes', []), true, 'sentence-case UI text');
});

test('a translation must keep every HTML tag', () => {
  assert.strictEqual(sameTags('Read <a href="%s">the guide</a>', 'Lies <a href="%s">die Anleitung</a>'), true);
  assert.strictEqual(sameTags('Read <strong>this</strong>', 'Lies das'), false);
});

test('an acronym is protected in capitals only', () => {
  const { droppedTerms } = require('../lib/translate');
  assert.deepStrictEqual(droppedTerms('Not the rest of your site.', 'Nicht der Rest deiner Website.', ['REST']), []);
  assert.deepStrictEqual(droppedTerms('Use the REST API.', 'Nutze die Schnittstelle.', ['REST', 'API']), ['REST', 'API']);
  assert.deepStrictEqual(droppedTerms('Reign Settings', 'Herrschaft Einstellungen', ['Reign']), ['Reign'], 'a capitalised brand still matches any case');
});
