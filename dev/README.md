# Facebook Program Collector

Collect public Facebook events from venues listed in `venues.md` and write a markdown report grouped by area, with event name, URL, date, venue closing time, and venue address.

## Setup

```sh
cd dev
npm install
npx playwright install chromium
```

## Venues file

Use a Markdown venue catalog in `venues.md`.

```md
# Venues

## Bulinegyed

### Gödör Klub

- https://www.facebook.com/godorklub
- 02:00
- Budapest, Király utca 8-10.

## Nyolcker

### Gólya

- https://www.facebook.com/golyaszovetkezet
- 01:00
- Budapest, Orczy út 46-48.
```

Each venue must have exactly three bullet rows in this order: Facebook URL, closing time, address. Blank lines are fine. A legacy file with one Facebook URL per row is still accepted, but those venues are grouped as `Uncategorized` and have no closing time or address in the report.

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
  --venues-file venues.md \
  --dates 2026-05-01,2026-05-02 \
  --out output/program.md \
  --headed
```

Useful flags:

- `--venues-file`: Markdown venue catalog. Default: `venues.md`.
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
