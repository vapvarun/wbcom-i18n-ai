# Translating a Wbcom plugin: runbook for any agent

For Claude Code, Cursor or a person. Follow the steps in order. The rules and the reasons behind them are in [`docs/translation-standard.md`](docs/translation-standard.md); read it once before starting.

Run every command from the plugin repo (where `.wbcom-i18n.json` lives). `wbcom-i18n` below means `node <path-to>/wbcom-i18n-ai/bin/wbcom-i18n.js` until the package is published.

## 0. Before anything

- Pull this repo. The checkout must include the commit "Lean claude calls" (`git log --oneline | grep -i lean`). Without it, every call loads your whole editor session (about 84,000 tokens).
- Pick the engine for the subscription you are on:
  - Claude: default, no flag. Needs the `claude` CLI logged in.
  - Cursor: `--engine=cursor --model=claude-haiku-5-5-medium`. Needs `cursor-agent` logged in.
- Never use an API key. Never paste strings into a chat to translate them by hand.

## 1. Set up the config (once per plugin)

In `.wbcom-i18n.json`:

```json
"glossaryFile": ".wbcom-i18n-glossary.json",
"model": "haiku",
"review": true,
"batch": 40
```

- Remove any per-locale `model` override.
- Every locale entry has a `register`, for example `"register": "informal (du)"`.
- Pro uses `"glossaryFile": "../<free-repo>/.wbcom-i18n-glossary.json"`.
- Exclude `.wbcom-i18n-glossary.json` from the release zip (`bin/build-release.sh`, `.distignore`).

## 2. Write the glossary (once per plugin family)

Create `.wbcom-i18n-glossary.json` in the Free repo with a `brief` and about 30 core terms, each with its `meaning` and a rendering for every language. The format is in the standard; `jetonomy/.wbcom-i18n-glossary.json` is a full example. Choose the words WordPress core, BuddyPress and bbPress already use in each language.

## 3. Plan and post it before any model call

```bash
for f in languages/*.po; do printf "%s " "$f"; msgfmt --statistics -o /dev/null "$f"; done
```

Post on the card:
- strings needing work per language
- batches (strings / 40) and calls (× 2)
- time (about 12 seconds per call on claude, 22 on cursor)
- the run order

Wait for the owner's OK if the plan is above about 500 calls.

## 4. Pilot one small language

```bash
wbcom-i18n sync
wbcom-i18n translate --locales=<one locale>        # add --review-all for an existing bad catalogue
wbcom-i18n check --locales=<that locale>
```

Read its sample sheet (the path is printed). If the check has FAIL lines or the sheet has more than 2 WRONG out of 40, stop and fix the glossary or config before going on.

## 5. Run the rest, about 5 languages side by side

```bash
for l in de_DE fr_FR es_ES it_IT nl_NL; do wbcom-i18n translate --locales=$l > i18n-$l.log 2>&1 & done; wait
```

Then the next group. Same tokens as one at a time, a fifth of the time. Each language writes only its own file. Keep the logs outside the repo.

- `--review-all` re-checks every existing entry. Use it once for a catalogue known to be bad, never as routine.
- A plain `translate` only takes empty and fuzzy entries, so re-running it is cheap.
- `unconfirmed=N` in a DONE line: N strings could not be done (a failed call). Run `translate` again for that language.

## 6. Check every language

```bash
wbcom-i18n check --core=<site>/wp-content/languages
```

- **FAIL:** fix it. For a glossary line, fix the strings or, if the rendering itself is wrong, fix the glossary and re-run that language with `--review-all`.
- **REVIEW:** look at each example and decide. Inflected words and homonyms are often fine.
- Mark the sample sheets for German, French and Japanese: OK or WRONG with a reason, for each of the 40 rows.

## 7. Browser check

German, French and Japanese, at desktop and at 390px: admin settings, a member-facing page and one email. Nothing wraps, gets cut off or shows a wrong word.

## 8. Compile, commit, report

```bash
wbcom-i18n compile
```

- Commit the `.po`, `.mo`, `.json` and `.l10n.php` files with the config and glossary.
- Post the check output, the marked sheets and the screenshots on the card.
- Name a native speaker for money, access and moderation strings.
