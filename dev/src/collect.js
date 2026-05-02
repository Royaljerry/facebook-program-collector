import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_TIME_ZONE = 'Europe/Budapest';
const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const DEFAULT_VENUES_FILE = 'venues.md';
const DEFAULT_AREA = 'Uncategorized';
const SINGLE_VENUE_AREA = 'Custom venue';

const MONTHS = {
  en: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  enShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  hu: [
    'januar',
    'februar',
    'marcius',
    'aprilis',
    'majus',
    'junius',
    'julius',
    'augusztus',
    'szeptember',
    'oktober',
    'november',
    'december',
  ],
  huAccented: [
    'január',
    'február',
    'március',
    'április',
    'május',
    'június',
    'július',
    'augusztus',
    'szeptember',
    'október',
    'november',
    'december',
  ],
  huShort: ['jan', 'febr', 'márc', 'ápr', 'máj', 'jún', 'júl', 'aug', 'szept', 'okt', 'nov', 'dec'],
};

const WEEKDAYS = {
  en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  enShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  hu: ['vasarnap', 'hetfo', 'kedd', 'szerda', 'csutortok', 'pentek', 'szombat'],
  huAccented: ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'],
};

function parseArgs(argv) {
  const options = {
    venue: null,
    venuesFile: DEFAULT_VENUES_FILE,
    dates: null,
    out: null,
    headed: false,
    keepOpen: false,
    debug: false,
    maxEvents: 30,
    timeZone: DEFAULT_TIME_ZONE,
    profileDir: path.join(ROOT_DIR, '.facebook-profile'),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new Error(`Missing value for ${arg}`);
      }
      index += 1;
      return value;
    };

    if (arg === '--venue') {
      options.venue = readValue();
    } else if (arg === '--venues-file') {
      options.venuesFile = readValue();
    } else if (arg === '--dates') {
      options.dates = readValue()
        .split(',')
        .map((date) => date.trim())
        .filter(Boolean);
    } else if (arg === '--out') {
      options.out = readValue();
    } else if (arg === '--headed') {
      options.headed = true;
    } else if (arg === '--keep-open') {
      options.keepOpen = true;
      options.headed = true;
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--max-events') {
      options.maxEvents = Number.parseInt(readValue(), 10);
    } else if (arg === '--timezone') {
      options.timeZone = readValue();
    } else if (arg === '--profile-dir') {
      options.profileDir = resolveInsideDev(readValue());
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!Number.isFinite(options.maxEvents) || options.maxEvents < 1) {
    throw new Error('--max-events must be a positive number');
  }

  if (!options.dates) {
    options.dates = currentWeekFridaySaturday(options.timeZone);
  }

  options.dates.forEach(assertIsoDate);

  if (!options.out) {
    const slug = options.venue ? venueSlug(options.venue) || 'facebook-venue' : 'program';
    options.out = `output/${slug}-${options.dates.join('_')}.md`;
  }

  options.out = resolveInsideDev(options.out);
  options.venuesFile = resolveInsideDev(options.venuesFile);
  options.profileDir = resolveInsideDev(options.profileDir);

  return options;
}

function printHelp() {
  console.log(`Facebook Program Collector

Usage:
  npm run collect -- --dates 2026-05-01,2026-05-02
  npm run collect -- --venue https://www.facebook.com/godorklub --dates 2026-05-01,2026-05-02

Options:
  --venues-file <path>   Markdown venue catalog, default venues.md
  --venue <url>          Single Facebook venue page URL; overrides --venues-file
  --dates <dates>        Comma-separated YYYY-MM-DD dates
  --out <path>           Markdown output path, inside dev unless absolute
  --headed               Open a visible browser
  --keep-open            Leave the visible browser open at the end
  --debug                Write debug/last-run.json with candidate extraction details
  --max-events <number>  Candidate event page limit, default 30
  --timezone <tz>        Timezone for default dates, default Europe/Budapest
`);
}

function resolveInsideDev(targetPath) {
  const resolved = path.isAbsolute(targetPath) ? path.resolve(targetPath) : path.resolve(ROOT_DIR, targetPath);
  const relative = path.relative(ROOT_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside dev: ${targetPath}`);
  }
  return resolved;
}

function assertIsoDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`Date must be YYYY-MM-DD: ${date}`);
  }

  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`Invalid date: ${date}`);
  }
}

function currentWeekFridaySaturday(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(new Date());

  const get = (type) => parts.find((part) => part.type === type)?.value;
  const today = `${get('year')}-${get('month')}-${get('day')}`;
  const weekday = get('weekday');
  const weekdayIndex = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday);
  const fridayOffset = 5 - weekdayIndex;
  const friday = addDays(today, fridayOffset);

  return [friday, addDays(friday, 1)];
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function venueSlug(venueUrl) {
  try {
    const url = new URL(venueUrl);
    const parts = url.pathname.split('/').filter(Boolean);
    return parts[0]?.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
  } catch {
    return null;
  }
}

function eventsUrlForVenue(venueUrl) {
  const url = new URL(venueUrl);
  url.hash = '';

  if (url.pathname.replace(/\/+$/, '') === '/profile.php' && url.searchParams.has('id')) {
    url.searchParams.set('sk', 'events');
    return url.toString();
  }

  url.search = '';
  const parts = url.pathname.split('/').filter(Boolean);

  if (!parts.includes('events')) {
    parts.push('events');
  }

  url.pathname = `/${parts.join('/')}`;
  return url.toString();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const venues = await loadVenues(options);
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.mkdir(options.profileDir, { recursive: true });

  const areaCount = countAreas(venues);
  console.log(
    `Collecting ${venues.length} venue${venues.length === 1 ? '' : 's'} across ${areaCount} area${
      areaCount === 1 ? '' : 's'
    }`,
  );
  if (!options.venue) {
    console.log(`Venues file: ${path.relative(ROOT_DIR, options.venuesFile)}`);
  }
  console.log(`Dates: ${options.dates.join(', ')}`);
  console.log(`Output: ${path.relative(ROOT_DIR, options.out)}`);

  const context = await chromium.launchPersistentContext(options.profileDir, {
    headless: !options.headed,
    locale: 'en-US',
    timezoneId: options.timeZone,
    viewport: { width: 1440, height: 1200 },
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });

  const page = context.pages()[0] ?? (await context.newPage());
  page.setDefaultTimeout(15_000);

  const venueResults = [];
  try {
    for (const [index, venueEntry] of venues.entries()) {
      console.log(`\n[${index + 1}/${venues.length}] Collecting ${venueDisplayName(venueEntry)} (${venueEntry.area})`);
      try {
        const result = await collectVenueEvents(page, { ...options, venueEntry });
        venueResults.push(result);
      } catch (error) {
        venueResults.push(failedVenueResult(venueEntry, options.dates, error));
      }
    }
  } finally {
    if (options.keepOpen) {
      console.log('Browser left open because --keep-open was used. Press Ctrl+C when done.');
    } else {
      await context.close();
    }
  }

  const result = {
    source: options.venue ? '--venue' : path.relative(ROOT_DIR, options.venuesFile),
    dates: options.dates,
    generatedAt: new Date().toISOString(),
    venueResults,
  };
  const markdown = renderMarkdown(result);
  await fs.writeFile(options.out, markdown, 'utf8');
  console.log(`Wrote ${path.relative(ROOT_DIR, options.out)}`);

  if (options.debug) {
    const debugPath = path.join(ROOT_DIR, 'debug', 'last-run.json');
    await fs.mkdir(path.dirname(debugPath), { recursive: true });
    await fs.writeFile(debugPath, `${JSON.stringify(result.venueResults, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${path.relative(ROOT_DIR, debugPath)}`);
  }

  const notes = result.venueResults.flatMap((venueResult) =>
    venueResult.notes.map((note) => `${venueResult.venueLabel}: ${note}`),
  );
  if (notes.length > 0) {
    console.log('\nNotes:');
    notes.forEach((note) => console.log(`- ${note}`));
  }
}

function failedVenueResult(venueEntry, dates, error) {
  return {
    area: venueEntry.area || DEFAULT_AREA,
    venueUrl: venueEntry.url,
    venueLabel: venueDisplayName(venueEntry),
    closingTime: venueEntry.closingTime || '',
    address: venueEntry.address || '',
    eventsUrl: safeEventsUrlForVenue(venueEntry.url),
    dates,
    events: [],
    notes: [`Could not collect this venue: ${error.message}`],
    debugEvents: [],
  };
}

function safeEventsUrlForVenue(venueUrl) {
  try {
    return eventsUrlForVenue(venueUrl);
  } catch {
    return venueUrl;
  }
}

async function loadVenues(options) {
  if (options.venue) {
    return [
      makeVenueEntry({
        area: SINGLE_VENUE_AREA,
        url: options.venue,
      }),
    ];
  }

  let content;
  try {
    content = await fs.readFile(options.venuesFile, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`Venue file not found: ${path.relative(ROOT_DIR, options.venuesFile)}`);
    }
    throw error;
  }

  const venues = parseVenuesFile(content, path.relative(ROOT_DIR, options.venuesFile));

  if (venues.length === 0) {
    throw new Error(`Venue file has no URLs: ${path.relative(ROOT_DIR, options.venuesFile)}`);
  }

  return venues;
}

function parseVenuesFile(content, sourceLabel) {
  const lines = content.split(/\r?\n/);

  if (hasMarkdownVenueStructure(lines)) {
    return dedupeVenueEntries(parseMarkdownVenueEntries(lines, sourceLabel));
  }

  return dedupeVenueEntries(parseLegacyVenueEntries(lines));
}

function hasMarkdownVenueStructure(lines) {
  return lines.some((rawLine) => {
    const line = rawLine.trim();
    return /^##\s+\S/.test(line) || /^###\s+\S/.test(line);
  });
}

function parseMarkdownVenueEntries(lines, sourceLabel) {
  const venues = [];
  let currentArea = '';
  let currentVenue = null;

  const finishVenue = () => {
    if (!currentVenue) {
      return;
    }

    if (currentVenue.items.length !== 3) {
      throw new Error(
        `${sourceLabel}:${currentVenue.lineNumber} venue "${currentVenue.name}" must have exactly three bullet rows: url, closing time, address`,
      );
    }

    venues.push(
      makeVenueEntry({
        area: currentVenue.area,
        name: currentVenue.name,
        url: extractVenueUrlValue(currentVenue.items[0].value),
        closingTime: stripVenueDetailLabel(currentVenue.items[1].value),
        address: stripVenueDetailLabel(currentVenue.items[2].value),
      }),
    );
    currentVenue = null;
  };

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (!line || line.startsWith('<!--')) {
      return;
    }

    const venueMatch = line.match(/^###\s+(.+)$/);
    if (venueMatch) {
      finishVenue();
      if (!currentArea) {
        throw new Error(`${sourceLabel}:${lineNumber} venue heading appears before an area heading`);
      }
      currentVenue = {
        area: currentArea,
        name: normalizeVenueDetail(venueMatch[1]),
        lineNumber,
        items: [],
      };
      return;
    }

    const areaMatch = line.match(/^##\s+(.+)$/);
    if (areaMatch) {
      finishVenue();
      currentArea = normalizeVenueDetail(areaMatch[1]);
      if (!currentArea) {
        throw new Error(`${sourceLabel}:${lineNumber} area heading is empty`);
      }
      return;
    }

    if (/^#\s+/.test(line)) {
      return;
    }

    const bulletMatch = line.match(/^-\s*(.*)$/);
    if (bulletMatch) {
      if (!currentVenue) {
        throw new Error(`${sourceLabel}:${lineNumber} bullet row appears before a venue heading`);
      }
      currentVenue.items.push({
        value: bulletMatch[1].trim(),
        lineNumber,
      });
      return;
    }

    throw new Error(`${sourceLabel}:${lineNumber} could not parse venue catalog line: ${line}`);
  });

  finishVenue();

  return venues;
}

function parseLegacyVenueEntries(lines) {
  return lines
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((url) =>
      makeVenueEntry({
        area: DEFAULT_AREA,
        url,
      }),
    );
}

function dedupeVenueEntries(venues) {
  const seen = new Set();
  const unique = [];

  for (const venue of venues) {
    if (!seen.has(venue.url)) {
      seen.add(venue.url);
      unique.push(venue);
    }
  }

  return unique;
}

function makeVenueEntry({ area = DEFAULT_AREA, name = '', url, closingTime = '', address = '' }) {
  const normalizedUrl = normalizeVenueUrl(url);
  validateVenueUrl(normalizedUrl);

  return {
    area: normalizeVenueDetail(area) || DEFAULT_AREA,
    name: normalizeVenueDetail(name),
    url: normalizedUrl,
    closingTime: normalizeVenueDetail(closingTime),
    address: normalizeVenueDetail(address),
  };
}

function venueDisplayName(venueEntry) {
  return venueEntry.name || venueSlug(venueEntry.url) || venueEntry.url;
}

function countAreas(venues) {
  return new Set(venues.map((venue) => venue.area || DEFAULT_AREA)).size;
}

function normalizeVenueUrl(value) {
  return stripVenueDetailLabel(value).replace(/^<(.+)>$/, '$1').trim();
}

function extractVenueUrlValue(value) {
  const stripped = stripVenueDetailLabel(value);
  const markdownLinkMatch = stripped.match(/\((https?:\/\/[^)]+)\)/i);
  return normalizeVenueUrl(markdownLinkMatch?.[1] ?? stripped);
}

function stripVenueDetailLabel(value) {
  const text = normalizeVenueDetail(value);
  const match = text.match(/^(?:url|facebook url|closing time|closing|closes|address)\s*:\s*(.*)$/i);
  return match ? match[1].trim() : text;
}

function normalizeVenueDetail(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function validateVenueUrl(venueUrl) {
  let url;
  try {
    url = new URL(venueUrl);
  } catch {
    throw new Error(`Invalid venue URL: ${venueUrl}`);
  }

  if (!/(\.|^)facebook\.com$/i.test(url.hostname)) {
    throw new Error(`Venue URL must be on facebook.com: ${venueUrl}`);
  }
}

async function collectVenueEvents(page, options) {
  const venueEntry = options.venueEntry;
  const targetDates = options.dates.map((date) => buildDateMatcher(date));
  const notes = [];
  const eventsUrl = eventsUrlForVenue(venueEntry.url);

  console.log(`Opening ${eventsUrl}`);
  await page.goto(eventsUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await settlePage(page);
  await dismissFacebookDialogs(page);
  const extractedVenueLabel = await extractVenueLabel(page, venueEntry.url);
  const venueLabel = venueEntry.name || extractedVenueLabel;

  const loginDetected = await isLoginDetected(page);
  if (loginDetected) {
    notes.push(
      'Facebook rendered login controls in the public view. Some event details may be hidden. Run with --headed, log in, then rerun for fuller extraction.',
    );
  }

  const candidates = await collectEventLinks(page, options.maxEvents);
  console.log(`Found ${candidates.length} candidate event links for ${venueLabel}`);

  if (candidates.length === 0) {
    notes.push('No event links were found on the venue events page. Facebook may require login, or the DOM changed.');
  }

  const events = [];
  const debugEvents = [];
  const seen = new Set();

  for (const candidate of candidates) {
    const eventUrl = canonicalEventUrl(candidate.url);
    if (seen.has(eventUrl)) {
      continue;
    }
    seen.add(eventUrl);

    console.log(`Inspecting ${eventUrl}`);
    const eventPage = await page.context().newPage();
    eventPage.setDefaultTimeout(15_000);

    try {
      const details = await inspectEventPage(eventPage, eventUrl, candidate.title);
      const matchingDate = findMatchingDate(details, targetDates);
      if (options.debug) {
        debugEvents.push({
          url: eventUrl,
          candidateTitle: candidate.title,
          title: details.title,
          startDate: details.startDate,
          dateText: details.dateText.slice(0, 1200),
          matchedDate: matchingDate?.iso ?? null,
        });
      }
      if (matchingDate) {
        events.push({
          date: matchingDate.iso,
          title: details.title,
          url: eventUrl,
        });
      }
    } catch (error) {
      notes.push(`Could not inspect ${eventUrl}: ${error.message}`);
    } finally {
      await eventPage.close();
    }
  }

  events.sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title));

  if (events.length === 0) {
    notes.push('No candidate event page clearly matched the target dates.');
  }

  return {
    area: venueEntry.area || DEFAULT_AREA,
    venueUrl: venueEntry.url,
    venueLabel,
    closingTime: venueEntry.closingTime || '',
    address: venueEntry.address || '',
    eventsUrl,
    dates: options.dates,
    events,
    notes,
    debugEvents,
  };
}

async function extractVenueLabel(page, venueUrl) {
  try {
    const label = await page.evaluate(() => {
      const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
      const heading = [...document.querySelectorAll('h1, [role="heading"]')]
        .map((element) => element.innerText || element.textContent || '')
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .find(Boolean);

      return meta('meta[property="og:title"]') || heading || document.title || '';
    });

    const cleaned = cleanTitle(label);
    if (cleaned && !/^facebook$/i.test(cleaned)) {
      return cleaned;
    }
  } catch {
    // Fall through to the URL-derived label.
  }

  return venueSlug(venueUrl) || venueUrl;
}

async function settlePage(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(2500);
}

async function dismissFacebookDialogs(page) {
  const labels = [
    'Allow all cookies',
    'Accept all',
    'Accept All',
    'Only allow essential cookies',
    'Decline optional cookies',
    'Not now',
    'Not Now',
    'Close',
    'Az összes cookie engedélyezése',
    'Összes cookie engedélyezése',
    'Az összes elfogadása',
    'Elfogadom',
    'Csak a szükséges cookie-k engedélyezése',
    'Most nem',
    'Bezárás',
  ];

  for (const label of labels) {
    const locator = page.getByRole('button', { name: label, exact: true }).first();
    try {
      if (await locator.isVisible({ timeout: 700 })) {
        await locator.click({ timeout: 2000 });
        await page.waitForTimeout(800);
      }
    } catch {
      // Dialog labels and visibility are highly variable; keep trying the next one.
    }
  }
}

async function isLoginDetected(page) {
  const loginMarkers = [
    'input[name="email"]',
    'input[name="pass"]',
    'text=/Log in to Facebook/i',
    'text=/Bejelentkezés a Facebookra/i',
    'text=/checkpoint/i',
  ];

  for (const marker of loginMarkers) {
    try {
      if (await page.locator(marker).first().isVisible({ timeout: 500 })) {
        return true;
      }
    } catch {
      // Continue with the next marker.
    }
  }

  return false;
}

async function collectEventLinks(page, maxEvents) {
  const byUrl = new Map();

  for (let step = 0; step < 8 && byUrl.size < maxEvents; step += 1) {
    const links = await extractEventLinks(page);
    for (const link of links) {
      const canonical = canonicalEventUrl(link.url);
      if (!byUrl.has(canonical)) {
        byUrl.set(canonical, { ...link, url: canonical });
      }
    }

    await page.mouse.wheel(0, 1400);
    await page.waitForTimeout(1200);
  }

  return [...byUrl.values()].slice(0, maxEvents);
}

async function extractEventLinks(page) {
  return page.evaluate(() => {
    const anchors = [...document.querySelectorAll('a[href]')];

    return anchors
      .map((anchor) => {
        const href = anchor.href;
        const text = [anchor.innerText, anchor.getAttribute('aria-label'), anchor.textContent]
          .filter(Boolean)
          .join('\n')
          .replace(/\s+/g, ' ')
          .trim();

        return { url: href, title: text };
      })
      .filter((link) => /facebook\.com\/events\/|\/events\//.test(link.url))
      .filter((link) => !/\/events\/calendar|\/events\/birthdays|\/events\/discovery/.test(link.url));
  });
}

function canonicalEventUrl(rawUrl) {
  const url = new URL(rawUrl, 'https://www.facebook.com');
  const match = url.pathname.match(/\/events\/(?:[^/\d][^/]*\/)?(\d+)/);

  if (match) {
    return `https://www.facebook.com/events/${match[1]}/`;
  }

  url.search = '';
  url.hash = '';
  return url.toString();
}

async function inspectEventPage(page, eventUrl, fallbackTitle) {
  await page.goto(eventUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await settlePage(page);
  await dismissFacebookDialogs(page);

  const payload = await page.evaluate(() => {
    const meta = (selector) => document.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
    const text = document.body?.innerText ?? '';
    const headings = [...document.querySelectorAll('h1, h2, [role="heading"]')]
      .map((element) => element.innerText || element.textContent || '')
      .map((value) => value.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const jsonLd = [...document.querySelectorAll('script[type="application/ld+json"]')]
      .map((script) => script.textContent)
      .filter(Boolean);

    return {
      title: meta('meta[property="og:title"]') || headings[0] || document.title || '',
      description:
        meta('meta[property="og:description"]') ||
        meta('meta[name="description"]') ||
        meta('meta[name="twitter:description"]') ||
        '',
      text,
      headings,
      jsonLd,
      startTime:
        meta('meta[property="event:start_time"]') ||
        meta('meta[property="og:start_time"]') ||
        meta('meta[name="event:start_time"]') ||
        '',
    };
  });

  const structured = parseEventJsonLd(payload.jsonLd);
  const text = compactText([payload.title, payload.description, payload.startTime, payload.text].join('\n'));
  const dateText = compactText(
    [payload.title, payload.description, payload.startTime, payload.headings.join('\n'), fallbackTitle].join('\n'),
  );
  const title = cleanTitle(structured.name || payload.title || fallbackTitle || 'Untitled Facebook event');

  return {
    title,
    text,
    dateText,
    startDate: structured.startDate || payload.startTime || '',
  };
}

function parseEventJsonLd(scripts) {
  const objects = [];

  for (const script of scripts) {
    try {
      objects.push(...flattenJson(JSON.parse(script)));
    } catch {
      // Some pages contain non-standard snippets. Metadata extraction is best effort.
    }
  }

  return objects.find((object) => String(object['@type'] || '').toLowerCase().includes('event')) ?? {};
}

function flattenJson(value) {
  if (Array.isArray(value)) {
    return value.flatMap(flattenJson);
  }

  if (value && typeof value === 'object') {
    const children = Object.values(value).flatMap((child) => {
      if (child && typeof child === 'object') {
        return flattenJson(child);
      }
      return [];
    });

    return [value, ...children];
  }

  return [];
}

function cleanTitle(title) {
  return title
    .replace(/\| Facebook$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(text) {
  return text
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function findMatchingDate(details, targetDates) {
  if (details.startDate) {
    const iso = normalizeDateFromMetadata(details.startDate);
    const match = targetDates.find((targetDate) => targetDate.iso === iso);
    if (match) {
      return match;
    }
  }

  const comparableText = normalizeForDateSearch(details.dateText || '');
  return targetDates.find((targetDate) => targetDate.needles.some((needle) => containsDateNeedle(comparableText, needle)));
}

function containsDateNeedle(text, needle) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const matcher = new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`, 'i');
  return matcher.test(text);
}

function normalizeDateFromMetadata(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    const isoMatch = String(value).match(/\d{4}-\d{2}-\d{2}/);
    return isoMatch?.[0] ?? '';
  }

  return parsed.toISOString().slice(0, 10);
}

function buildDateMatcher(iso) {
  const date = new Date(`${iso}T12:00:00Z`);
  const monthIndex = date.getUTCMonth();
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const weekday = date.getUTCDay();
  const paddedDay = String(day).padStart(2, '0');
  const paddedMonth = String(monthIndex + 1).padStart(2, '0');

  const rawNeedles = [
    iso,
    `${year}.${paddedMonth}.${paddedDay}`,
    `${year}. ${paddedMonth}. ${paddedDay}`,
    `${year}. ${MONTHS.huAccented[monthIndex]} ${day}`,
    `${year}. ${MONTHS.hu[monthIndex]} ${day}`,
    `${MONTHS.en[monthIndex]} ${day}`,
    `${MONTHS.enShort[monthIndex]} ${day}`,
    `${day} ${MONTHS.en[monthIndex]}`,
    `${day} ${MONTHS.enShort[monthIndex]}`,
    `${MONTHS.huAccented[monthIndex]} ${day}`,
    `${MONTHS.hu[monthIndex]} ${day}`,
    `${MONTHS.huShort[monthIndex]} ${day}`,
    `${day}. ${MONTHS.huAccented[monthIndex]}`,
    `${day}. ${MONTHS.hu[monthIndex]}`,
    `${WEEKDAYS.en[weekday]}, ${MONTHS.en[monthIndex]} ${day}`,
    `${WEEKDAYS.enShort[weekday]}, ${MONTHS.enShort[monthIndex]} ${day}`,
    `${WEEKDAYS.huAccented[weekday]}, ${MONTHS.huAccented[monthIndex]} ${day}`,
    `${WEEKDAYS.hu[weekday]}, ${MONTHS.hu[monthIndex]} ${day}`,
  ];

  return {
    iso,
    label: new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    }).format(date),
    needles: [...new Set(rawNeedles.map(normalizeForDateSearch))],
  };
}

function normalizeForDateSearch(value) {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function renderMarkdown(result) {
  const dateLabels = result.dates.map((date) => buildDateMatcher(date).label).join('; ');
  const totalEvents = result.venueResults.reduce((count, venueResult) => count + venueResult.events.length, 0);
  const areaGroups = groupVenueResultsByArea(result.venueResults);
  const venueSections = areaGroups.flatMap((group) => [
    `## ${escapeMarkdownHeading(group.area)}`,
    '',
    ...group.venues.flatMap(renderVenueMarkdown),
  ]);

  return [
    '# Facebook Program Collector Result',
    '',
    `- Source: ${result.source}`,
    `- Dates: ${dateLabels}`,
    `- Generated: ${result.generatedAt}`,
    `- Areas: ${areaGroups.length}`,
    `- Venues: ${result.venueResults.length}`,
    `- Events found: ${totalEvents}`,
    '',
    ...venueSections,
  ].join('\n');
}

function groupVenueResultsByArea(venueResults) {
  const groups = [];
  const byArea = new Map();

  for (const venueResult of venueResults) {
    const area = venueResult.area || DEFAULT_AREA;
    let group = byArea.get(area);

    if (!group) {
      group = { area, venues: [] };
      byArea.set(area, group);
      groups.push(group);
    }

    group.venues.push(venueResult);
  }

  return groups;
}

function renderVenueMarkdown(venueResult) {
  const rows = venueResult.events.map(
    (event) => `| ${escapeMarkdownCell(event.date)} | [${escapeMarkdownCell(event.title)}](${event.url}) |`,
  );

  if (rows.length === 0) {
    rows.push('| - | No matching events found |');
  }

  const venueDetails = [
    `- [Venue](${venueResult.venueUrl})`,
    `- [Events page](${venueResult.eventsUrl})`,
    venueResult.closingTime ? `- Closing time: ${escapeMarkdownText(venueResult.closingTime)}` : null,
    venueResult.address ? `- Address: ${escapeMarkdownText(venueResult.address)}` : null,
  ].filter(Boolean);

  const notes = venueResult.notes.length ? ['', ...venueResult.notes.map((note) => `- Note: ${note}`)] : [];

  return [
    `### ${escapeMarkdownHeading(venueResult.venueLabel)}`,
    '',
    ...venueDetails,
    '',
    '| Date | Event |',
    '| --- | --- |',
    ...rows,
    ...notes,
    '',
  ];
}

function escapeMarkdownHeading(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/#/g, '\\#')
    .trim();
}

function escapeMarkdownText(value) {
  return String(value || '')
    .replace(/\n/g, ' ')
    .trim();
}

function escapeMarkdownCell(value) {
  return String(value || '')
    .replace(/\|/g, '\\|')
    .replace(/\n/g, '<br>')
    .trim();
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
