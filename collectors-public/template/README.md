# Template plug-in

Example Market: a made-up card marketplace, to copy when writing a plug-in for a real site. It is
not loaded by `pnpm collect` (only `src/index.ts` of `collectors-public/` and `collectors/` are).

- `src/example-market.ts`: the collector (search, sales history with resume, conditions as buckets)
- `src/index.ts`: a package entry point with the source's description
- `fixtures/`: the site's answers, saved as files
- `test/example-market.test.ts`: the test, run by `pnpm test`

The guide: [docs/collectors.md](../../docs/collectors.md).
