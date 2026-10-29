# Wbcom translation standard

The one standard for translating every Wbcom plugin and theme into other languages. It applies to every translator: a person, Claude Code, Cursor or any other agent. The step-by-step runbook an agent follows is [`AGENTS.md`](../AGENTS.md). The source side (POT wording, translator comments, the build) is the `wbcom-catalogue-standard` in the wp-i18n skill.

Written 2026-10-29, after customers reported Jetonomy's shipped translations as bad.

**The test for every string:** would a site owner or member who speaks this language, and who knows a forum, community or LMS in that language (Discourse, bbPress, BuddyPress, LearnDash), read it as natural, correct and consistent with the screen around it? A word-for-word rendering fails the test even when every word is right.

## What went wrong before

| English | Shipped | Why it is wrong | Rule |
|---|---|---|---|
| Join request not found | de: Beitragsanfrage | means "post request"; join = Beitritt | 1, 3 |
| Join Requests / Pending Join Requests | de: Beitrittanfragen / Beitrittsanfragen | two spellings of one term | 5 |
| Reply (a label) | fr: Répondre | a verb; the label needs the noun Réponse | 2 |
| Grants (column heading) | de: Erteilt | a past participle; the column lists what is granted | 2 |
| Trust Level | de: Trust Level, Vertrauensstufe | one term, several renderings | 5 |
| Change Trust Level (button) | de: Ändere Trust Level | a command; German buttons use the infinitive | 7 |

Root causes: strings went out without their comment, context or source file; there was no glossary; one cheap pass and nothing reviewed it.

## Rules

1. **Translate the meaning in context, not the words.** Read the `translators:` comment, the `msgctxt`, the source file and the audience before translating. If it is still unclear, leave it empty and report it: an empty entry shows English, a wrong one ships.
2. **Know the kind of text.** A button or menu item is an action. A label, column heading or tab is a noun. A status chip is an adjective or short noun. A message is a full sentence, and an email is a full sentence a little more formal than the UI. "Reply" as a button is a verb; as a tab it is a noun.
3. **Use the glossary, always.** A glossary term is translated the same way in every string, in Free and Pro, on every screen.
4. **Use the vocabulary the community already knows.** Glossary choices follow what Discourse, bbPress, BuddyPress and WordPress core already say in that language. WordPress core's own translation wins for anything core also says (Settings, Save Changes, Dashboard, Users, Draft, Publish).
5. **One term, one spelling, one gender.** Before finishing, check that every string with a glossary term uses the same form.
6. **One register per language.** It is set per locale in the config (for example `informal (du)`, `polite (です/ます)`) and is the same for admin and member text. Never mix du/Sie or tu/vous.
7. **Follow the language's interface conventions.** German buttons use the infinitive ("Speichern", "Vertrauensstufe ändern"). French uses a non-breaking space before `: ; ! ?` and « ». German quotes are „ ". Japanese and Chinese use full-width punctuation.
8. **Keep short labels short.** Buttons, tabs and chips sit in tight space on a 390px phone screen. One or two English words become one or two words.
9. **Owner-renamable nouns arrive as placeholders, and the placeholder is the noun.** Some plugins let the site owner rename core nouns (Jetonomy: space, topic, reply, member, category), so the code passes them in as `%s`. Never write the noun as well: "einen Bereich (%s)" or "un élément (%s)" reads "Bereich (Bereich)" on every site that kept the default. The translator cannot know the word's gender or case, so put the placeholder where it needs no article or ending: at the start of a label or sentence, after a colon, or as a plain noun ("Gesperrt in %s", "Nur %s auf Einladung", "Tu es déjà %1$s de %2$s"). Then read the sentence with the default glossary word in place of `%s`: it must read as natural text. (`wbcom-i18n check` flags the bracket pattern as `label-nouns`.)
10. **Placeholders, tokens, HTML and protected names stay exactly as they are** (`%s`, `%1$s`, `{name}`, `<a href="%s">`, the product name, WordPress). Move them for word order; never drop, add or renumber them.
11. **Plurals get every form the language has** (`nplurals`), each with its placeholder. Japanese, Korean and Chinese have one form; Russian has three.
12. **Never copy the English** unless the whole string is a brand or protected name. A copied string looks done and shows English forever.
13. **The audience decides the words.** Admin screens speak to the site owner: plain and precise, with no developer jargon. Member screens speak to the member: friendly and short. Error messages say what happened and what to do, as the English does.

## The glossary

Each plugin family keeps one `.wbcom-i18n-glossary.json` in the Free repo; Pro points at it with `"glossaryFile": "../<free-repo>/.wbcom-i18n-glossary.json"`. Keep it out of the release zip.

```json
{
  "brief": "One paragraph: what the product is, who reads it, which nouns the owner can rename.",
  "glossary": {
    "space": {
      "meaning": "a community area holding topics, like a subforum or group",
      "de_DE": "Bereich", "fr_FR": "espace", "ja": "スペース"
    },
    "report": {
      "meaning": "to flag content to the moderators (or that flag)",
      "ru_RU": "жалоба / пожаловаться"
    }
  }
}
```

- About 30 core terms, each with its `meaning` and a rendering for every language.
- Separate a noun and a verb form with ` / ` when the language uses different words.
- A missing rendering means "not decided": decide once, record it, use it everywhere.
- Change a rendering, then re-run that language with `--review-all`.

## The tool and the engines

Translation runs through `@wbcom/i18n-ai` (`wbcom-i18n`), never by hand-pasting strings into a chat. The tool sends each string with its comment, context, source file, audience, the brief and the glossary terms it contains. A second review call checks every batch, and automatic gates hold back anything with broken placeholders, HTML, protected names or copied English (those stay fuzzy and show English).

We run on subscriptions, not API keys:

| Engine | Subscription | Model setting |
|---|---|---|
| `claude` (default) | Claude | `"model": "haiku"` (Claude Haiku 5.5) |
| `cursor` | Cursor | `--engine=cursor --model=claude-haiku-5-5-medium` |

Both engines make lean calls (a one-line system prompt, no tools, no project files or rules). A tool version without lean calls loads about 84,000 tokens of editor session into every call; on Jetonomy that emptied an account's weekly limit. Check that your checkout includes the commit "Lean claude calls".

**Settings, tested 2026-10-29:**

- **Model: Claude Haiku 5.5.** With context and the glossary it matched or beat Sonnet on the strings that shipped wrong, and gave identical results through either engine.
- **Batch: 40.** At 200 the review step caught 3× fewer errors and glossary terms slipped.
- **Review: on.** It is what catches wrong terms.

**A different model** (Gemini Flash, GPT Mini and so on) may replace Haiku 5.5 only after it passes the qualification test: re-translate the strings in the table above in German, French and Japanese, plus a 40-string sample read in each, with results at least as good as Haiku 5.5. Record the result in this file.

## Plan before any model call

Translation is data work, so it is planned and costed first. Post on the card:

1. Strings per language (`msgfmt --statistics`) and how many need work.
2. Batches (strings / 40) and calls (batches × 2).
3. A time estimate: about 12 seconds per call on the claude engine, 22 on cursor.
4. Which languages run side by side (about 5 at once: same tokens, a fraction of the time).

Then run one small language as a pilot, check its output with `wbcom-i18n check`, and only then run the rest.

## Output quality check

The automatic gates catch broken placeholders, HTML and copied English, never a wrong word. Run `wbcom-i18n check` (add `--core=<wp-content/languages>` to compare with WordPress core). It reports PASS, REVIEW, FAIL or SKIP per language:

| Check | What it looks at | Fails when |
|---|---|---|
| coverage | translated and not fuzzy | under 95% |
| placeholders | every shipped string keeps its placeholders | any mismatch |
| plural-forms | every form filled | any form empty |
| glossary | strings with a term use its rendering | a term is missing in over 30% of 10+ strings (over 10% is REVIEW) |
| label-nouns | a noun written next to its own label placeholder, "Bereich (%s)" | more than 5 strings |
| register | the form of address not chosen (Sie/du, vous/tu, usted/tú, u/je, Lei/tu, tu/você) | more than 2 strings |
| core-words | strings WordPress core also has match core's translation | listed as REVIEW |

REVIEW lines need a human look; they are often right (an inflected word, or "Code block" meaning an editor block, not a moderation block). The command also writes a **sample sheet** per language with 40 strings, the same 40 every run.

Then the human half, by a person or an agent acting as one:

1. **Sample read:** mark each of the 40 sheet rows OK or WRONG, with a reason (meaning, term, kind, register, length). More than 2 WRONG means another pass for that language.
2. **Kind of text:** the 30 strings on the main settings screen and the member profile. Buttons are actions, headings are nouns, chips are short.
3. **Plural grammar:** Russian forms read right with 1, 3 and 5.
4. **Browser:** German, French and Japanese at desktop and 390px: admin settings, a member-facing page and one email. Nothing wraps or gets cut off.

## Done means

- `wbcom-i18n check` shows no FAIL, and every REVIEW line has been looked at.
- Every language is at 95% or more, translated and not fuzzy, in Free and in Pro.
- The sample sheets for German, French and Japanese are marked, with 2 WRONG or fewer each.
- Browser screenshots are on the card.
- A native speaker is named for money, access and moderation strings before the release.
- Evidence on the card: the plan, the check output, the marked sheets and the screenshots.
