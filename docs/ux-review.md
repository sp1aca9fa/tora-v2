# UX review

Instructions for a fresh reviewer (a Claude subagent, or a person) who looks at pages the way a
new user would, before the owner does. The reviewer gets screenshots and one line per page on what
it is for, nothing else: no code, no spec, no history. Knowing how a page was built makes it
easier to forgive.

## What the reviewer is given

- Screenshots of each changed page: phone, wide and dark (`pnpm crawl --only /x --views
phone,wide,dark --shots <dir>`).
- Per page, one line: what it is for and who opens it ("pick what to buy this month, with a budget;
  a collector, a few times a month").
- Nothing else. If a page cannot be understood without more, that is a finding.

## What to look for

Answer as someone who has never seen the app. For each page:

1. **Purpose.** In five seconds, can you tell what this page is for and what to do first? Say what
   you think it is for; if that differs from the line given, that is the top finding.
2. **Amount.** Is there more on screen than the first task needs? Name what could be folded away,
   moved to a detail page, or dropped. Count the distinct things competing for attention above the
   fold on the phone.
3. **Words.** Jargon, internal names, abbreviations, numbers without units or a "compared with
   what". Labels that say the same thing two ways on one page, or one thing two ways across pages.
4. **Hierarchy.** Does the most important thing look most important? Headings, size and color
   used for one meaning each (e.g. green only for "good to buy").
5. **Consistency.** Cards, tags, buttons and lists of the same kind look and behave alike: same
   sizes side by side, same place for the same action, same order of facts.
6. **Navigation.** Where you can go from here, and how to get back. Tabs and links say where they
   lead. Nothing important only reachable by a hidden gesture.
7. **States.** Empty, loading, one item, very many items, long names, missing pictures or prices:
   what the screenshots show of them, and what they likely look like.
8. **Phone.** Tap targets, text that wraps badly, sideways scroll, things cut off.
9. **Trust.** Where the page states a guess or a forecast, does it say so plainly? Anything that
   could make a person spend money on a wrong reading is a top finding.
10. **Breaks and bugs.** Anything that looks wrong rather than unclear: numbers that don't add up
    or contradict each other, a total that doesn't match its items, overlapping or clipped parts,
    a layout that breaks at one width but not another, a control that looks dead, the same item
    shown twice. Say what you would expect instead.

## How to report

- At most 10 findings per page, most important first. Each: where (page, part), what a new user
  would think or do, why that is a problem, one concrete change. Plain words, no design jargon.
- Mark each as **fix** (clearly better, small), **bug** (looks broken) or **ask** (a trade-off to
  weigh; say which option you would pick).
- End with the one change per page that would help most.
- Then, apart from the findings, up to 3 **ideas**: a perspective the page hasn't taken into
  account, a different way to do its job, or something a collector would want next. Keep them
  short; they don't count toward the 10.
- No praise, no summary of what the page does well, no restating the screenshots.
