# CI

Two workflows run on GitHub, on a checkout without the private submodule.

- `CI` (`.github/workflows/ci.yml`, job `check`) runs the project's checks and the build on every
  push and pull request. The server's update waits for it on the exact commit (`ops/ci-status.sh`,
  `docs/home-server.md` section 7).
- `Process` (`.github/workflows/process.yml`, job `process-check`) runs on every push to `main`.

## Process check

`ops/process-check.mjs` asks: do the pushed commits carry the trailers their changed files require?
It catches a forgotten review, not a false claim. A red run means "review the open task". It has no
effect on the server: `ops/ci-status.sh` drops that job by its exact name, and its tests are outside
`pnpm test`.

Trailers go in the last paragraph of the commit message, before the attribution:

```
Ship-Task: add-export
Ship-Tier: 2
Ship-Reviews: code-reviewer
Co-Authored-By: ...
```

- Each commit with floor 1 or more needs `Ship-Task` and a `Ship-Tier` at or above its floor. A
  lower claim needs `Ship-Tier-Why: <reason>`. Docs, tests and submodule bumps need no trailers.
- A task's last commit in the push lists every reviewer its highest tier requires. Chunk commits
  omit `Ship-Reviews`.
- The slug must match `^[a-z0-9-]+$` and is public once pushed, so it follows the same no-private-names
  rule as a commit subject.
- An owner commit that skips the loop says `Ship-Owner: <why>`, which passes with a notice.

To fix a red run: run the missing review, then commit under the same `Ship-Task` with
`Ship-Reviews` (with `--allow-empty` if there is nothing to fix). No history rewrite: the next push
is judged on its own. A commit with no `Ship-Task` has no task to close, and only a history rewrite
could add one: look at it, then add its sha to `process-reviewed.txt` in the private ledger folder.
`--audit` keeps listing it as `unclaimed`; what stays open is `unreviewed`, the commits not in that
file.

A push that changes `ops/process-check.json` is judged by both versions, the one before the push and
the one it brings, and fails if either fails. A push that edits `process.yml` or the script runs its
own edited version: both are on the Paths list, so such an edit is Tier 2 by path.

By hand:

- `node ops/process-check.mjs origin/main` at the end of a task, so CI is only the backstop.
- `node ops/process-check.mjs --audit --reviewed <ledger folder>/process-reviewed.txt` at the setup
  review: tasks never closed, commits that fail a rule with no task to close (`unclaimed`), those not
  in the file (`unreviewed`), and counts. A session adds a sha only after looking at that commit. A
  missing file means every unclaimed commit counts.
- `node --test ops/process-check.test.mjs` for the script's own tests.

`ops/process-check.json` holds the path patterns. It must agree with the trust-territory Paths list
in `docs/agents.md`, and a test in the process job checks both ways.

`ops/process-check.mjs`, its test and the workflow are copies of the shared templates: change them in
the `selfhost-blueprint` repo first. The rules, the exemptions and their limits are in that repo's
`docs/ci.md`.

To remove it, go in this order: revert the workflow, check the server has updated, then revert the
filter in `ops/ci-status.sh`. With the filter gone and the job still running, a red process run holds
the server back again.
