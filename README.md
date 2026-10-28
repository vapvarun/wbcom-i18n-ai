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
- **Brand-aware** — `protect` terms (Jetonomy, Pro, WordPress…) are checked, not just requested; all-capital acronyms (REST, API) match in capitals only.
- **Context, not bare strings (0.2)** — every string goes to the model with its `msgctxt`, the developer's `translators:` comment, its source file and its audience (admin / member / email, from the file path), plus a product `brief`. A label, a button and a sentence get translated as what they are.
- **Per-locale glossary (0.2)** — each core term carries what it means and the word to use in each language (see below). The batch gets only the terms it contains.
- **Reviewed (0.2)** — a second model pass checks each new translation against the rules (meaning in context, kind of text, glossary, register, locale conventions, length) and corrects it. Only then is it written.
- **More gates (0.2)** — besides placeholders and protected names: dropped or added HTML tags, and sentence-case UI text left in English, fall back to English. Glossary misses and Title Case strings kept in English are listed in the run report for a person to check.
- **Plurals done right (0.2)** — all plural forms of an entry are requested together, so a language with three forms (Russian, Polish) gets three different strings.

The rules come from the Wbcom translation quality guideline (`wp-i18n` skill, `references/translation-quality.md`), written after customers reported translations made without context as bad: a verb where a label needed a noun, a wrong word for a core term, one term rendered three ways.

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

## Configure — `.wbcom-i18n.json` (plugin/theme root)

See `.wbcom-i18n.example.json`. Per-locale `model` lets you use Haiku for European languages and Sonnet for Korean/CJK.

### `type` — set this correctly or the whole run is dead weight

WordPress looks for a **different filename** depending on what it is loading:

| `type`             | file it reads                  | loader                     |
|--------------------|--------------------------------|----------------------------|
| `plugin` (default) | `languages/{domain}-{locale}.mo` | `load_plugin_textdomain()` |
| `theme`            | `languages/{locale}.mo`          | `load_theme_textdomain()`  |

Emitting the plugin form for a theme produces files WordPress **silently never loads** — no
error, no warning, just English. It also means `sync` won't find the existing `{locale}.po`,
so it runs `msginit` instead of `msgmerge` and re-translates every string from scratch,
discarding the translations you already have.

```json
{ "domain": "reign", "type": "theme", "potFile": "languages/reign.pot" }
```

### `makePhp` (default `true`)

WordPress 6.5+ reads a sibling `{base}.l10n.php` **in preference to the `.mo`**. If one exists
and you refresh only the `.mo`, every new translation is invisible on the site while the stale
`.l10n.php` keeps serving. `compile` regenerates them via `wp i18n make-php`.

### `protect` — proper nouns ONLY

`protect` is **enforced**, not suggested: if a term appears in the source and not in the
translation, the entry is flagged `fuzzy`, gettext leaves it out of the .mo, and the
string falls back to English. That is the right outcome for a mangled brand name — and
the wrong one for anything else.

So list product and company names, nothing more:

```json
"protect": ["Reign", "Wbcom", "WooCommerce", "BuddyPress", "Dokan"]
```

Do **not** list technical acronyms (URL, API, REST, HTML, CSS) or ordinary words like
"Pro". Many languages translate them correctly and idiomatically — Arabic renders "URL"
as "رابط" — and enforcing them throws that good translation away in favour of English.
Translating Reign we lost 11 correct Arabic strings that way before trimming the list.

The prompt still asks the model to leave technical terms alone; it just isn't a hard
failure when a language has a better word.

### `batch`

One model call per `batch` entries (default 40), plus one review call. Each entry now carries
its context, note, file and audience, so batches are smaller than in 0.1; raise it only if
replies stay complete.

### `brief`, `glossary`, `glossaryFile` (0.2)

```json
{
  "brief": "Jetonomy is a WordPress community forum plugin. Members join spaces ...",
  "glossary": {
    "space": { "meaning": "a community area holding topics, like a subforum", "de_DE": "Bereich", "fr_FR": "espace" },
    "trust level": { "meaning": "a member's earned level", "de_DE": "Vertrauensstufe", "fr_FR": "niveau de confiance" }
  }
}
```

A family (Free + Pro) keeps one file and points both configs at it with
`"glossaryFile": "../plugin/.wbcom-i18n-glossary.json"` (the file holds `brief` and `glossary`).
Choose renderings from what Discourse, bbPress, BuddyPress and WordPress core already use in
each language. A missing locale value means "not decided": the model picks the established word
and keeps it consistent. The 0.1 flat form `{ "Space": "Bereich" }` still works.

### `model`, `review`

`model` defaults to `sonnet` (0.1 used `haiku`); `review` defaults to `true`. Per locale you may
set `model` and `reviewModel`.

## CLI

```bash
wbcom-i18n all                       # sync → translate → compile, all locales
wbcom-i18n translate --locales=de_DE # one locale
wbcom-i18n sync                      # just merge new strings
wbcom-i18n compile                   # just build .mo + .json
wbcom-i18n all --engine=api --model=sonnet
wbcom-i18n all --review-all          # re-review EVERY entry (old text sent as a starting point)
wbcom-i18n translate --locales=de_DE --review-all --only='Trust Level'   # spot-test some strings
```

Re-review a catalogue that is known to be bad with `--review-all`; later releases go back to the
default incremental run.

## Grunt

```js
// Gruntfile.js
require('@wbcom/i18n-ai/grunt')(grunt);
grunt.registerTask('build', ['makepot', 'i18n', 'rtlcss', 'cssmin', 'uglify']);
```

`grunt i18n` runs sync → translate → compile, so `grunt build` (and your release script) keeps all locales current automatically.

## License

GPL-2.0-or-later.
