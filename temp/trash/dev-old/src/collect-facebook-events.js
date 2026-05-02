import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import {
  addDays,
  classifyEventDate,
  escapeMarkdownLinkText,
  escapeMarkdownTableCell,
  extractEntryFee,
  makeDateRange
} from './parsing.js';

const DEFAULT_VENUE_URL = 'https://www.facebook.com/godorklub';
const DEFAULT_VENUE_NAME = 'Gödör';
const DEFAULT_PROFILE_DIR = '.fb-profile';
const DEFAULT_MAX_EVENTS = 16;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const from = options.from ?? todayInTimeZone(options.timeZone);
  const to = options.to ?? addDays(from, 1);
  const outPath = path.resolve(options.out ?? `output/godor-${from}.md`);
  const debugPath = outPath.replace(/\.md$/i, '.debug.json');
  const targetDates = makeDateRange(from, to);

  await fs.mkdir(path.dirname(outPath), { recursive: true });

  const context = await chromium.launchPersistentContext(path.resolve(options.profileDir), {
    headless: options.headless,
    locale: 'hu-HU',
    timezoneId: options.timeZone,
    viewport: { width: 1440, height: 1000 }
  });

  try {
    const venuePage = await context.newPage();
    const venueEventsUrl = toVenueEventsUrl(options.venue);

    console.log(`Opening ${venueEventsUrl}`);
    await venuePage.goto(venueEventsUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await maybeAcceptCookieDialog(venuePage);
    await waitForFacebookShell(venuePage);
    await autoScroll(venuePage);

    const candidateEvents = await collectEventCandidates(venuePage, options.maxEvents);
    console.log(`Found ${candidateEvents.length} candidate event link(s).`);

    const events = [];
    for (const candidate of candidateEvents) {
      const event = await collectEventDetail(context, candidate, targetDates);

      if (event.dateIso) {
        events.push(event);
        console.log(`Matched ${event.dateIso}: ${event.title}`);
      } else {
        console.log(`Skipped non-target date: ${event.title}`);
      }
    }

    const markdown = renderMarkdown({
      venueName: options.venueName,
      venueUrl: options.venue,
      targetDates,
      events
    });

    await fs.writeFile(outPath, markdown, 'utf8');
    await fs.writeFile(
      debugPath,
      JSON.stringify(
        {
          venueUrl: options.venue,
          venueEventsUrl,
          from,
          to,
          candidateCount: candidateEvents.length,
          events
        },
        null,
        2
      ),
      'utf8'
    );

    console.log(`Wrote ${path.relative(process.cwd(), outPath)}`);
    console.log(`Wrote ${path.relative(process.cwd(), debugPath)}`);
  } finally {
    await context.close();
  }
}

async function collectEventDetail(context, candidate, targetDates) {
  const page = await context.newPage();

  try {
    await page.goto(candidate.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await maybeAcceptCookieDialog(page);
    await waitForFacebookShell(page);
    await page.waitForTimeout(1200);

    const title = await getEventTitle(page, candidate);
    const bodyText = await page.locator('body').innerText({ timeout: 10000 }).catch(() => '');
    const targetDate = classifyEventDate(`${candidate.text}\n${title}\n${bodyText}`, targetDates);
    const fee = extractEntryFee(bodyText);

    return {
      title,
      url: canonicalizeEventUrl(page.url(), candidate.url),
      sourceText: candidate.text,
      dateIso: targetDate?.iso ?? null,
      dateLabel: targetDate?.label ?? null,
      entryFee: fee.value,
      entryFeeConfidence: fee.confidence,
      entryFeeEvidence: fee.evidence
    };
  } catch (error) {
    return {
      title: candidate.text || candidate.url,
      url: candidate.url,
      sourceText: candidate.text,
      dateIso: null,
      dateLabel: null,
      entryFee: '?',
      entryFeeConfidence: 'unknown',
      entryFeeEvidence: '',
      error: error instanceof Error ? error.message : String(error)
    };
  } finally {
    await page.close();
  }
}

async function collectEventCandidates(page, maxEvents) {
  const links = await page.$$eval('a[href]', (anchors) =>
    anchors.map((anchor) => ({
      href: anchor.href,
      text: anchor.innerText || anchor.getAttribute('aria-label') || ''
    }))
  );

  const unique = new Map();

  for (const link of links) {
    const normalized = normalizeFacebookEventLink(link.href);
    if (!normalized) {
      continue;
    }

    const existing = unique.get(normalized.key);
    if (!existing || link.text.length > existing.text.length) {
      unique.set(normalized.key, {
        url: normalized.url,
        text: link.text.replace(/\s+/g, ' ').trim()
      });
    }
  }

  return [...unique.values()].slice(0, maxEvents);
}

function normalizeFacebookEventLink(rawHref) {
  let url;
  try {
    url = new URL(rawHref);
  } catch {
    return null;
  }

  if (!/(^|\.)facebook\.com$/i.test(url.hostname)) {
    return null;
  }

  const pathParts = url.pathname.split('/').filter(Boolean);
  const eventIndex = pathParts.indexOf('events');
  if (eventIndex === -1) {
    return null;
  }

  const eventId = pathParts.slice(eventIndex + 1).find((part) => /^\d{5,}$/.test(part));
  if (eventId) {
    return {
      key: eventId,
      url: `https://www.facebook.com/events/${eventId}/`
    };
  }

  return null;
}

function canonicalizeEventUrl(currentUrl, fallbackUrl) {
  return normalizeFacebookEventLink(currentUrl)?.url ?? normalizeFacebookEventLink(fallbackUrl)?.url ?? fallbackUrl;
}

async function getEventTitle(page, candidate) {
  const pageTitle = await page
    .evaluate(() => {
      const h1 = document.querySelector('h1')?.innerText?.trim();
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim();
      const documentTitle = document.title?.trim();

      return h1 || ogTitle || documentTitle || '';
    })
    .catch(() => '');
  const cleanPageTitle = cleanupTitle(pageTitle);
  const candidateTitle = cleanupTitle(candidate.text);

  if (candidateTitle && isGenericFacebookTitle(cleanPageTitle)) {
    return candidateTitle;
  }

  return cleanPageTitle || candidateTitle || candidate.url;
}

function cleanupTitle(value) {
  return String(value ?? '')
    .replace(/\s*\|\s*Facebook.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericFacebookTitle(value) {
  const normalized = value.toLocaleLowerCase('hu-HU');
  return !normalized || ['events', 'események', 'facebook'].includes(normalized);
}

function renderMarkdown({ venueName, venueUrl, targetDates, events }) {
  const headerDates = targetDates.map((date) => `${date.label}, ${date.iso}`);
  const cells = targetDates.map((date) => {
    const dateEvents = events.filter((event) => event.dateIso === date.iso);

    if (dateEvents.length === 0) {
      return '?';
    }

    return dateEvents
      .map((event) => {
        const title = escapeMarkdownLinkText(event.title);
        const fee = escapeMarkdownTableCell(event.entryFee || '?');
        return `[${title}](${event.url}) (${fee})`;
      })
      .join('<br>');
  });

  return [
    `# Program Collector: ${escapeMarkdownTableCell(venueName)}`,
    '',
    `Source: [${escapeMarkdownLinkText(venueName)}](${venueUrl})`,
    '',
    `| Venue | ${headerDates.map(escapeMarkdownTableCell).join(' | ')} |`,
    `|:------|${targetDates.map(() => ':---').join('|')}|`,
    `| [${escapeMarkdownLinkText(venueName)}](${venueUrl}) | ${cells.join(' | ')} |`,
    ''
  ].join('\n');
}

async function maybeAcceptCookieDialog(page) {
  const labels = [
    /allow all cookies/i,
    /accept all/i,
    /accept optional cookies/i,
    /az osszes cookie engedelyezese/i,
    /osszes cookie engedelyezese/i,
    /elfogadom/i
  ];

  for (const label of labels) {
    const button = page.getByRole('button', { name: label }).first();
    if (await button.isVisible({ timeout: 800 }).catch(() => false)) {
      await button.click().catch(() => {});
      await page.waitForTimeout(700);
      return;
    }
  }
}

async function waitForFacebookShell(page) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(1500);
}

async function autoScroll(page) {
  let previousHeight = 0;

  for (let index = 0; index < 8; index += 1) {
    const height = await page.evaluate(() => document.body.scrollHeight).catch(() => 0);
    if (height === previousHeight && index > 2) {
      break;
    }

    previousHeight = height;
    await page.mouse.wheel(0, 2200).catch(() => {});
    await page.waitForTimeout(1000);
  }

  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
}

function toVenueEventsUrl(rawVenueUrl) {
  const url = new URL(rawVenueUrl);
  url.hash = '';

  if (url.pathname === '/profile.php') {
    url.searchParams.set('sk', 'events');
    return url.toString();
  }

  const cleanPath = url.pathname.replace(/\/+$/, '');
  if (cleanPath.endsWith('/events')) {
    return url.toString();
  }

  url.pathname = `${cleanPath}/events`;
  url.search = '';
  return url.toString();
}

function parseArgs(argv) {
  const parsed = {
    venue: DEFAULT_VENUE_URL,
    venueName: DEFAULT_VENUE_NAME,
    profileDir: DEFAULT_PROFILE_DIR,
    timeZone: 'Europe/Budapest',
    headless: false,
    maxEvents: DEFAULT_MAX_EVENTS
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[index];
    };

    if (arg === '--venue') {
      parsed.venue = next();
    } else if (arg === '--venue-name') {
      parsed.venueName = next();
    } else if (arg === '--from') {
      parsed.from = next();
    } else if (arg === '--to') {
      parsed.to = next();
    } else if (arg === '--out') {
      parsed.out = next();
    } else if (arg === '--profile-dir') {
      parsed.profileDir = next();
    } else if (arg === '--timezone') {
      parsed.timeZone = next();
    } else if (arg === '--max-events') {
      parsed.maxEvents = Number(next());
    } else if (arg === '--headless') {
      parsed.headless = true;
    } else if (arg === '--headed') {
      parsed.headless = false;
    } else if (arg === '--help' || arg === '-h') {
      printHelpAndExit();
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return parsed;
}

function todayInTimeZone(timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function printHelpAndExit() {
  console.log(`Usage:
  node src/collect-facebook-events.js --venue <facebook-url> --from YYYY-MM-DD --to YYYY-MM-DD --out output.md

Defaults:
  --venue ${DEFAULT_VENUE_URL}
  --from today in Europe/Budapest
  --to tomorrow

Flags:
  --headless
  --profile-dir .fb-profile
  --max-events ${DEFAULT_MAX_EVENTS}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
