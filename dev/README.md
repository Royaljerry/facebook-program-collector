# Facebook Program Collector

First iteration: collect public Facebook events from one venue and write a markdown table with event name, URL, date, and detected entry fee.

## Setup

```sh
cd dev
npm install
npx playwright install chromium
```

## Run the Gödör Klub query

```sh
npm run collect:godor
```

The default output path is:

```text
dev/output/godorklub-2026-05-01_2026-05-02.md
```

If Facebook asks for login, cookies, or extra verification, run the same query in a visible browser:

```sh
npm run collect:godor -- --headed
```

Log in or accept the dialog in the opened browser window, then run the command again. The browser session is stored in `dev/.facebook-profile`.

## Custom query

```sh
npm run collect -- \
  --venue https://www.facebook.com/godorklub \
  --dates 2026-05-01,2026-05-02 \
  --out output/godor.md \
  --headed
```

Useful flags:

- `--venue`: Facebook venue/page URL.
- `--dates`: comma-separated `YYYY-MM-DD` dates. If omitted, the current week's Friday and Saturday are used in the `Europe/Budapest` timezone.
- `--out`: markdown output path, relative to `dev` unless absolute.
- `--headed`: open a visible browser.
- `--keep-open`: leave the browser open at the end, useful while logging in.
- `--debug`: write candidate extraction details to `dev/debug/last-run.json`.
- `--max-events`: maximum candidate event pages to inspect. Default: `30`.
