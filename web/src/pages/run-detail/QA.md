# Task 7 verification

- Branch: `p5-t07-run-detail`; starting `feat-redesign` commit: `4b43622d93522cdaa15ed43f888fe14a267dbce6`.
- Scope: only `web/src/pages/run-detail/`; no dependencies or server/shared files changed.
- Plan deviations: none. The line diff uses LCS with a bounded table and a remove/add fallback for very large changed regions.

## Behavior

Run detail now has the back link, token-based header/summary cards, whole-run and failed-only reruns, matrix cell selection, responsive selected-task panel, step timeline and expandable screenshot/hierarchy links. The selected task supports AI fix creation, live cached job updates, attempts, failure states, summary/assumptions, original-commit file diffs, and editor links pinned to the run commit. Artifact tabs preserve image/video downloads, lazy UTF-8-safe final-200KB log previews, cancellation confirmation, masked environment values and the options panel.

## Tests first and final checks

- New run-detail tests initially: `Test Files 1 failed (1)` / `Tests 8 failed | 3 passed (11)` (`/tmp/p5-t07-red.log`).
- Added the large-diff regression before its fix: `Tests 1 failed | 2 passed (3)` (`/tmp/p5-t07-diff-red.log`), reproducing the JavaScript argument limit.
- `pnpm install --frozen-lockfile`: passed, lockfile unchanged.
- `pnpm typecheck`: passed.
- `pnpm test`: `Test Files 19 passed (19)` / `Tests 140 passed (140)` (`/tmp/p5-t07-all-tests.log`).
- `pnpm build`: passed, `built in 611ms` (`/tmp/p5-t07-build.log`).
- `git diff --check`: passed.
- Existing tests retain their assertions. Gallery/download/log tests now select the requested tabs; the SSE artifact test waits for task remount/refetch before opening the gallery, as required by the new tabbed layout.

## Browser QA

Used local Vite at `127.0.0.1:5277` with contract-shaped mocked APIs, including `/ai/*`; no provider call or deployed-server mutation was made. Aside REPL could not connect (`fetch failed`), so verification used the available Playwright connector.

| View | Theme | innerWidth / scrollWidth | Result |
| --- | --- | --- | --- |
| Step timeline | light | 1440 / 1440 | Right column, selected cell, screenshot/hierarchy visible |
| Step timeline | dark | 1440 / 1440 | Semantic surfaces and status colors verified |
| Step timeline | light | 390 / 390 | Panel below matrix; table and tabs scroll internally |
| Step timeline | dark | 390 / 390 | Same layout without page overflow |
| Completed AI diff | light | 1440 / 1440 and 390 / 390 | Summary, assumptions, removed/added lines and editor link |
| Completed AI diff | dark | 1440 / 1440 and 390 / 390 | Same content and colors without page overflow |

Clicked a matrix flow cell (only that cell becomes selected), the screenshot tab, and AI fix. Observed the running message and then succeeded diff after a query refresh; checked `/editor/ws1?base=<run-sha>&aiJob=ai-qa`. ArrowRight from the focused steps tab selected the screenshot tab. Screenshots were visually inspected; captures are `/tmp/p5-t07-{light,dark}-{1440,390}.png` and `/tmp/p5-t07-ai-{light,dark}-{1440,390}.png` (temporary local evidence).

Browser QA proves rendering and mocked interactions. Real AI provider operation, cross-task editor application and deployed integration remain for the coordinator's integration wave. Server tests were not run because no server files changed.
