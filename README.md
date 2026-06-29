# @wbcom/i18n-ai

AI-translate WordPress plugin/theme `.po` files as part of your build/release — **sync new strings, translate them, validate, compile**. Wires into `grunt` and `bin/build-release.sh`; reusable across every plugin via one `devDependency`.

It does **not** replace human translators where you want them — it produces solid first-pass translations (Claude) so locales ship populated; site owners refine per-site with **Loco Translate**.

## Quick start — translate a new plugin or theme in 5 steps

Prereqs (one-time on the machine): `brew install gettext`, plus `wp-cli` and the `claude` CLI (or `ANTHROPIC_API_KEY`).

```bash
cd /path/to/the-plugin

# 1. install
npm i -D @wbcom/i18n-ai          # run `npm init -y` first if there's no package.json

# 2. ensure a .pot exists
grunt makepot                    # or: wp i18n make-pot . languages/SLUG.pot --domain=SLUG

# 3. add .wbcom-i18n.json (copy .wbcom-i18n.example.json, set "domain" to your text domain)

# 4. translate
npx wbcom-i18n all               # sync -> translate -> compile (.po + .mo + .json)

# 5. commit languages/*.po + *.mo
```

Optional: add `require('@wbcom/i18n-ai/grunt')(grunt);` to `Gruntfile.js` for a `grunt i18n` task. Add languages by adding objects to `locales` in the config. Re-running later only translates **new/changed** strings (incremental, cheap).

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
- **Checkpointed** — progress is saved to the `.po` every `saveEvery` strings (default 200), so a pause/crash never loses work; re-running resumes from disk and re-spends no quota.
- **Brand-aware** — `protect` terms (Jetonomy, Pro, WordPress…) and an optional `glossary` keep terminology consistent.

## Cost & throughput (read before a big run)

Each batch of `batch` strings (default **80**) is **one** model call. A 3,800-string plugin ≈ 48 calls per language.

- **Engine `claude` (default)** uses your Claude **subscription** — no per-token bill, but it counts against your **plan usage limits**. Running many locales **in parallel** drains that budget fast (e.g. 10 locales × 48 calls back-to-back). Prefer **2–4 concurrent locales**, or run sequentially, for a large plugin.
- **Engine `api`** (`--engine=api`, needs `ANTHROPIC_API_KEY`) bills per token (~$1–3 to seed a 2–4k-string plugin in 5 languages) but has no plan-usage ceiling — better for big parallel runs.
- Raise `batch` (e.g. 100) to cut the call count further; lower it only if replies get truncated.
- It's a **one-time** seed — later releases translate only new strings (pennies / a handful of calls).

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
