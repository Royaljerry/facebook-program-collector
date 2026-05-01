# Program Collector

First iteration: collect the current Friday/Saturday Facebook events for one venue and render a markdown table row.

The collector uses Playwright because Facebook event pages are client-rendered and may need an authenticated browser session.

## Setup

```sh
cd program-collector
npm run setup
```

## Log in to Facebook once

```sh
npm run login
```

This opens a visible Chromium window and stores the session in `program-collector/.fb-profile/`.

## Collect Gödör events for May 1-2, 2026

```sh
npm run collect:godor
```

Output is written to:

```text
program-collector/output/godor-2026-05-01.md
```

The script also writes a JSON debug file with the event snippets and extracted fee evidence.

## Useful options

```sh
node src/collect-facebook-events.js \
  --venue https://www.facebook.com/godorklub \
  --from 2026-05-01 \
  --to 2026-05-02 \
  --out output/godor-2026-05-01.md
```

Optional flags:

- `--headless` runs the browser invisibly.
- `--profile-dir <path>` changes where the Facebook browser session is stored.
- `--max-events <number>` limits how many event pages are visited after scanning the venue page.

If the markdown contains `?` even though the venue has events, run `npm run login` again. Facebook often shows less data to logged-out or fresh browser sessions.
