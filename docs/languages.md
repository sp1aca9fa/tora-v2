# Languages

The app has a **primary language** and an optional **secondary language**, picked by the admin in
**Settings > Admin preferences > Languages** from the installed ones. Anyone who has not chosen,
and the sign-in page, gets the primary; everyone switches between the two with the language
toggle. With no secondary language there is no toggle. Dates, numbers and charts follow the page's
language.

Item names do not follow the app's language: an item's name is as sold in the primary market (so
collectors find it on that market's sites), and its second name is the secondary market's. Both
are editable and searched.

Installed today: English (`en`) and Japanese (`ja`).

## Adding a language

1. Copy `apps/web/messages/en.json` to `apps/web/messages/{code}.json` (`fr`, `zh`, ... as BCP 47
   codes) and translate the values, never the keys. About 900 texts; Claude can draft it ("translate
   this file's values into French, keep the keys, the `{placeholders}` and the ICU plural and select
   syntax as they are"), then read it through.
2. Add the code to `LANGUAGES` in `apps/web/src/i18n/locale.ts`, with the toggle's short label:
   `fr: { short: 'FR' }`.
3. Run `pnpm test`: a text missing from the new file, or one the code asks for that `en.json`
   lacks, fails the test.
4. Deploy, then pick it in Settings > Admin preferences > Languages.

Market names are texts too (`sources.market.<code>`): add one for each market you use, in every
language file.

The admin's own names (categories, kinds, fields, condition values) are written in Settings, in
the app's two languages.
