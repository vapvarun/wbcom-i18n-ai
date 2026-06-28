# @wbcom/i18n-ai

AI-translate WordPress plugin/theme `.po` files as part of your build/release — **sync new strings, translate them, validate, compile**. Wires into `grunt` and `bin/build-release.sh`; reusable across every plugin via one `devDependency`.

It does **not** replace human translators where you want them — it produces solid first-pass translations (Claude) so locales ship populated; site owners refine per-site with **Loco Translate**.

## How it works

```
grunt makepot                 # your existing step → fresh .pot
wbcom-i18n sync               # msgmerge .pot → each locale .po  (NEW → untranslated, CHANGED → fuzzy)
wbcom-i18n translate          # AI-fill ONLY untranslated + fuzzy entries (incremental, cheap)
wbcom-i18n compile            # msgfmt -c → .mo  +  wp i18n make-json → JS/block .json
# or: wbcom-i18n all
```

- **Incremental** — `sync` (msgmerge) means each release only translates *new/changed* strings; existing translations are preserved.
- **Crash-safe** — every translation's printf placeholders (`%s`, `%1$s`…) are validated against the source. A mismatch marks the entry `fuzzy`, so gettext won't compile it → the string **falls back to English instead of crashing**. No human review required for safety.
- **Brand-aware** — `protect` terms (Jetonomy, Pro, WordPress…) and an optional `glossary` keep terminology consistent.

## Install

```bash
npm i -D @wbcom/i18n-ai          # plus system tools: gettext (msginit/msgmerge/msgfmt), wp-cli, and the `claude` CLI
```

Requirements: Node ≥18, GNU **gettext**, **wp-cli** (for `make-json`), and an engine — the **`claude` CLI** (default, no API key) or `ANTHROPIC_API_KEY` (`--engine=api`).

## Configure — `.wbcom-i18n.json` (plugin root)

See `.wbcom-i18n.example.json`. Per-locale `model` lets you use Haiku for European languages and Sonnet for Korean/CJK.

## CLI

```bash
wbcom-i18n all                       # sync → translate → compile, all locales
wbcom-i18n translate --locales=de_DE # one locale
wbcom-i18n sync                      # just merge new strings
wbcom-i18n compile                   # just build .mo + .json
wbcom-i18n all --engine=api --model=sonnet
```

## Grunt

```js
// Gruntfile.js
require('@wbcom/i18n-ai/grunt')(grunt);
grunt.registerTask('build', ['makepot', 'i18n', 'rtlcss', 'cssmin', 'uglify']);
```

`grunt i18n` runs sync → translate → compile, so `grunt build` (and your release script) keeps all locales current automatically.

## License

GPL-2.0-or-later.
