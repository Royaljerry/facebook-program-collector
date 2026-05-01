import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const DEFAULT_VENUE = 'https://www.facebook.com/godorklub';
const DEFAULT_TIME_ZONE = 'Europe/Budapest';
const ROOT_DIR = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

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
    venue: DEFAULT_VENUE,
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
    const slug = venueSlug(options.venue) || 'facebook-venue';
    options.out = `output/${slug}-${options.dates.join('_')}.md`;
  }

  options.out = resolveInsideDev(options.out);
  options.profileDir = resolveInsideDev(options.profileDir);

  return options;
}

function printHelp() {
  console.log(`Facebook Program Collector

Usage:
  npm run collect -- --venue https://www.facebook.com/godorklub --dates 2026-05-01,2026-05-02

Options:
  --venue <url>          Facebook venue page URL
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
  url.search = '';
  url.hash = '';
  const parts = url.pathname.split('/').filter(Boolean);

  if (!parts.includes('events')) {
    parts.push('events');
  }

  url.pathname = `/${parts.join('/')}`;
  return url.toString();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await fs.mkdir(path.dirname(options.out), { recursive: true });
  await fs.mkdir(options.profileDir, { recursive: true });

  console.log(`Collecting ${options.venue}`);
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

  let result;
  try {
    result = await collectVenueEvents(page, options);
  } finally {
    if (options.keepOpen) {
      console.log('Browser left open because --keep-open was used. Press Ctrl+C when done.');
    } else {
      await context.close();
    }
  }

  const markdown = renderMarkdown(result);
  await fs.writeFile(options.out, markdown, 'utf8');
  console.log(`Wrote ${path.relative(ROOT_DIR, options.out)}`);

  if (options.debug) {
    const debugPath = path.join(ROOT_DIR, 'debug', 'last-run.json');
    await fs.mkdir(path.dirname(debugPath), { recursive: true });
    await fs.writeFile(debugPath, `${JSON.stringify(result.debugEvents, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${path.relative(ROOT_DIR, debugPath)}`);
  }

  if (result.notes.length > 0) {
    console.log('\nNotes:');
    result.notes.forEach((note) => console.log(`- ${note}`));
  }
}

async function collectVenueEvents(page, options) {
  const targetDates = options.dates.map((date) => buildDateMatcher(date));
  const notes = [];
  const eventsUrl = eventsUrlForVenue(options.venue);

  console.log(`Opening ${eventsUrl}`);
  await page.goto(eventsUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await settlePage(page);
  await dismissFacebookDialogs(page);

  const loginDetected = await isLoginDetected(page);
  if (loginDetected) {
    notes.push(
      'Facebook rendered login controls in the public view. Some details, especially ticket prices, may be hidden. Run with --headed, log in, then rerun for fuller extraction.',
    );
  }

  const candidates = await collectEventLinks(page, options.maxEvents);
  console.log(`Found ${candidates.length} candidate event links`);

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
      if (matchingDate && details.fee === 'Not found') {
        const ticketFee = await extractFeeFromTicketLinks(eventPage.context(), details.ticketLinks);
        if (ticketFee) {
          details.fee = ticketFee.value;
          details.feeEvidence = ticketFee.evidence;
        }
      }
      if (options.debug) {
        debugEvents.push({
          url: eventUrl,
          candidateTitle: candidate.title,
          title: details.title,
          startDate: details.startDate,
          dateText: details.dateText.slice(0, 1200),
          matchedDate: matchingDate?.iso ?? null,
          fee: details.fee,
          feeEvidence: details.feeEvidence,
          ticketLinks: details.ticketLinks,
        });
      }
      if (matchingDate) {
        events.push({
          date: matchingDate.iso,
          title: details.title,
          url: eventUrl,
          fee: details.fee,
          feeEvidence: details.feeEvidence,
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
    venueUrl: options.venue,
    eventsUrl,
    dates: options.dates,
    generatedAt: new Date().toISOString(),
    events,
    notes,
    debugEvents,
  };
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
      links: [...document.querySelectorAll('a[href]')].map((anchor) => ({
        url: anchor.href,
        text: [anchor.innerText, anchor.getAttribute('aria-label'), anchor.textContent]
          .filter(Boolean)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim(),
      })),
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
  const offerFee = feeFromStructuredOffers(structured.offers);
  const extractedFee = offerFee ?? extractEntryFee(text);
  const ticketLinks = extractTicketLinks(payload.links);

  return {
    title,
    text,
    dateText,
    startDate: structured.startDate || payload.startTime || '',
    fee: extractedFee.value,
    feeEvidence: extractedFee.evidence,
    ticketLinks,
  };
}

async function extractFeeFromTicketLinks(context, ticketLinks) {
  for (const ticketLink of ticketLinks.slice(0, 3)) {
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);

    try {
      await page.goto(ticketLink.url, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForTimeout(2500);
      const text = await page.locator('body').innerText({ timeout: 10_000 });
      const fee = extractEntryFee(text);

      if (fee.value !== 'Not found') {
        return {
          value: fee.value,
          evidence: `Ticket page ${ticketLink.url}: ${fee.evidence}`,
        };
      }
    } catch {
      // External ticket pages are best effort; Facebook data should still be returned.
    } finally {
      await page.close();
    }
  }

  return null;
}

function extractTicketLinks(rawLinks) {
  const byUrl = new Map();

  for (const rawLink of rawLinks || []) {
    const url = unwrapFacebookRedirect(rawLink.url);
    if (!url || !isTicketLikeLink(url, rawLink.text)) {
      continue;
    }

    byUrl.set(url, { url, text: rawLink.text });
  }

  return [...byUrl.values()].slice(0, 5);
}

function unwrapFacebookRedirect(rawUrl) {
  try {
    const url = new URL(rawUrl, 'https://www.facebook.com');
    const redirected = url.searchParams.get('u');

    if (redirected && /facebook\.com\/l\.php$/i.test(url.hostname + url.pathname)) {
      return new URL(redirected).toString();
    }

    url.hash = '';
    return url.toString();
  } catch {
    return '';
  }
}

function isTicketLikeLink(rawUrl, text = '') {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (/(\.|^)facebook\.com$/i.test(url.hostname)) {
    return false;
  }

  const haystack = `${text} ${url.hostname} ${url.pathname}`.toLowerCase();
  return /ticket|tickets|jegy|jegyvasarlas|tixa|cooltix|eventim|oneticket|funcode|rock1|jegy\.hu/.test(haystack);
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

function feeFromStructuredOffers(offers) {
  const offerList = Array.isArray(offers) ? offers : offers ? [offers] : [];

  for (const offer of offerList) {
    if (!offer || typeof offer !== 'object') {
      continue;
    }

    const price = offer.price ?? offer.lowPrice ?? offer.highPrice;
    if (price === undefined || price === null || price === '') {
      continue;
    }

    const numeric = Number.parseFloat(String(price).replace(',', '.'));
    if (Number.isFinite(numeric) && numeric === 0) {
      return { value: 'Free', evidence: 'structured offer price: 0' };
    }

    const currency = offer.priceCurrency || offer.currency || '';
    return {
      value: `${price}${currency ? ` ${currency}` : ''}`,
      evidence: 'structured offer price',
    };
  }

  return null;
}

function extractEntryFee(text) {
  const lines = text
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const freeLine = lines.find((line) => /\bfree\b|ingyenes|d[ií]jtalan|szabad bel[eé]p[eé]s/i.test(line));
  if (freeLine) {
    return { value: 'Free', evidence: freeLine };
  }

  const currencyPriceRegex =
    /\b(?:HUF|Ft|forint)\s*\d{3,6}\b|\b\d{3,6}\s*(?:HUF|Ft|forint)\b|\b\d{1,3}(?:[ .]\d{3})+\s*(?:HUF|Ft|forint)\b|\b(?:HUF|Ft|forint)\s*\d{1,3}(?:[ .]\d{3})+\b/gi;
  const bareThousandPriceRegex = /\b\d{1,3}(?:[ .]\d{3})+\b/g;
  const feeWords =
    /ticket|tickets|entry|admission|door|presale|price|fee|jegy|jegy[aá]r|bel[eé]p[oő]|helysz[ií]n|el[oő]v[eé]tel/i;

  const feeLines = lines
    .filter((line) => containsPrice(line, currencyPriceRegex) || (feeWords.test(line) && containsPrice(line, bareThousandPriceRegex)))
    .map((line) => {
      currencyPriceRegex.lastIndex = 0;
      bareThousandPriceRegex.lastIndex = 0;
      return line;
    })
    .filter((line) => feeWords.test(line))
    .slice(0, 3);

  if (feeLines.length > 0) {
    return {
      value: summarizePrices(feeLines.join(' / ')) || feeLines.join(' / '),
      evidence: feeLines.join(' / '),
    };
  }

  const anyPriceLine = lines.find((line) => {
    currencyPriceRegex.lastIndex = 0;
    return currencyPriceRegex.test(line);
  });

  if (anyPriceLine) {
    return {
      value: summarizePrices(anyPriceLine) || anyPriceLine,
      evidence: anyPriceLine,
    };
  }

  return { value: 'Not found', evidence: '' };
}

function containsPrice(line, regex) {
  regex.lastIndex = 0;
  const result = regex.test(line);
  regex.lastIndex = 0;
  return result;
}

function summarizePrices(text) {
  const matches = text.match(
    /\b(?:HUF|Ft|forint)\s*\d{3,6}\b|\b\d{3,6}\s*(?:HUF|Ft|forint)\b|\b\d{1,3}(?:[ .]\d{3})+\s*(?:HUF|Ft|forint)\b|\b(?:HUF|Ft|forint)\s*\d{1,3}(?:[ .]\d{3})+\b|\b\d{1,3}(?:[ .]\d{3})+\b/gi,
  );

  if (!matches?.length) {
    return '';
  }

  return [...new Set(matches.map((match) => match.replace(/\s+/g, ' ').trim()))].slice(0, 4).join(', ');
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
  const rows = result.events.map(
    (event) =>
      `| ${escapeMarkdownCell(event.date)} | [${escapeMarkdownCell(event.title)}](${event.url}) | ${escapeMarkdownCell(
        event.fee,
      )} |`,
  );

  if (rows.length === 0) {
    rows.push('| - | No matching events found | - |');
  }

  const notes = result.notes.length
    ? ['## Notes', '', ...result.notes.map((note) => `- ${note}`), '']
    : [];

  return [
    '# Facebook Program Collector Result',
    '',
    `- Venue: ${result.venueUrl}`,
    `- Events page: ${result.eventsUrl}`,
    `- Dates: ${dateLabels}`,
    `- Generated: ${result.generatedAt}`,
    '',
    '## Events',
    '',
    '| Date | Event | Entry fee |',
    '| --- | --- | --- |',
    ...rows,
    '',
    ...notes,
  ].join('\n');
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
