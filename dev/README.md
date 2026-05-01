# Facebook Program Collector

Collect public Facebook events from venues listed in `venues.txt` and write a markdown report with event name, URL, and date.

## Setup

```sh
cd dev
npm install
npx playwright install chromium
```

## Venues file

Put one Facebook venue URL per row in `venues.txt`.

Blank lines and rows starting with `#` are ignored.

## Run the venues query

```sh
npm run collect
```

The default output path is:

```text
dev/output/program-<date>_<date>.md
```

If Facebook asks for login, cookies, or extra verification, run the same query in a visible browser:

```sh
npm run collect -- --headed
```

Log in or accept the dialog in the opened browser window, then run the command again. The browser session is stored in `dev/.facebook-profile`.

## Custom query

```sh
npm run collect -- \
  --venues-file venues.txt \
  --dates 2026-05-01,2026-05-02 \
  --out output/program.md \
  --headed
```

Useful flags:

- `--venues-file`: file with one Facebook venue URL per line. Default: `venues.txt`.
- `--venue`: single Facebook venue/page URL; overrides `--venues-file`.
- `--dates`: comma-separated `YYYY-MM-DD` dates. If omitted, the current week's Friday and Saturday are used in the `Europe/Budapest` timezone.
- `--out`: markdown output path, relative to `dev` unless absolute.
- `--headed`: open a visible browser.
- `--keep-open`: leave the browser open at the end, useful while logging in.
- `--debug`: write candidate extraction details to `dev/debug/last-run.json`.
- `--max-events`: maximum candidate event pages to inspect. Default: `30`.

Single-venue smoke test:

```sh
npm run collect:godor
```
