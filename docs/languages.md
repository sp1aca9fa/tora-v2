# Languages

The app has a **primary language** and an optional **secondary language**, picked by the admin in
**Settings > Admin preferences > Languages** from the installed ones. Anyone who has not chosen,
and the sign-in page, gets the primary; everyone switches between the two with the language
toggle. With no secondary language there is no toggle. Dates, numbers and charts follow the page's
language.

Item names do not follow the app's language: an item's name is as sold in the primary market (so
collectors find it on that market's sites), and its second name is the secondary market's. Both
are editable and searched.

Installed today: English (`en`, the base: every text is there), Japanese (`ja`) and Spanish
(`es`; drafted by Claude for the S10 Spain setup, not yet checked by a native speaker).

A language file may be partial: a text it lacks shows in English. New features add their texts to
`en.json` only; each language catches up when whoever looks after it translates them.

## Adding a language

1. Add `apps/web/messages/{code}.json` (`fr`, `zh`, ... as BCP 47 codes). Start from a copy of
   `en.json`, or from only the texts you want; translate the values, never the keys. Set
   `languages.short` to the toggle's label (`"FR"`; the code in capitals without it).
2. Run `pnpm test`: a text that does not parse, or one `en.json` lacks (a typo in a key, a text
   since removed), fails.
3. Deploy (the app finds the files when it is built), then pick it in Settings > Admin
   preferences > Languages.

To keep a language up: `pnpm languages` shows how many texts each one lacks; `pnpm languages fr`
prints those `fr` lacks, in English, as JSON to translate and merge into `fr.json`. Claude can
draft it ("translate this file's values into French, keep the keys, the `{placeholders}` and the
ICU plural and select syntax as they are"), then read it through. About 2,000 texts in all.

## Numbers in a text

A text never types one of the app's own numbers (a window in days, a limit, a share). It names it
in double square brackets, such as `[[rangeDays]]`, and the number is filled in from the code when
the texts are loaded, so a text cannot keep an old number after the code changes. The names and
their values are in `packages/core/src/text-numbers.ts`, `packages/db/src/text-numbers.ts` and
`apps/web/src/i18n/text-numbers.ts`.

- **Translating**: keep each `[[name]]` as it is and write the sentence around it. A text names
  the same numbers as its English text (a shorter one that leaves a number out is listed, with the
  reason, in `apps/web/src/i18n/text-numbers.test.ts`).
- **Writing a new English text**: a digit is either one of these names or on that test's reviewed
  list with why it is not one of the code's numbers (an example, a format, a label).
- Anything that reads a text file without the app (a script that sends alerts) reads it through
  `readAlertTexts` (`@tora/db/alert-texts`), which fills the numbers in the same way.

Market names are texts too (`sources.market.<code>`): add one for each market you use in
`en.json`, and in the other files when translated.

The admin's own names (categories, kinds, fields, condition values) are written in Settings, in
the app's two languages.
