const HUNGARIAN_MONTHS = [
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
  'december'
];

const HUNGARIAN_MONTHS_SHORT = [
  'jan',
  'feb',
  'marc',
  'apr',
  'maj',
  'jun',
  'jul',
  'aug',
  'szept',
  'okt',
  'nov',
  'dec'
];

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIsoDate(isoDate) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) {
    throw new Error(`Invalid date "${isoDate}". Use YYYY-MM-DD.`);
  }

  return {
    iso: isoDate,
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3])
  };
}

export function addDays(isoDate, days) {
  const parsed = parseIsoDate(isoDate);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days, 12));
  return date.toISOString().slice(0, 10);
}

export function makeDateRange(fromIso, toIso) {
  const dates = [];
  for (let current = fromIso; current <= toIso; current = addDays(current, 1)) {
    dates.push(makeTargetDate(current));
  }
  return dates;
}

export function makeTargetDate(isoDate) {
  const parsed = parseIsoDate(isoDate);
  const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12));
  const monthName = normalizeText(
    new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' }).format(date)
  );
  const monthShort = normalizeText(
    new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date)
  );
  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(date);

  return {
    ...parsed,
    label: weekday,
    patterns: buildDatePatterns({
      ...parsed,
      monthName,
      monthShort,
      huMonth: HUNGARIAN_MONTHS[parsed.month - 1],
      huMonthShort: HUNGARIAN_MONTHS_SHORT[parsed.month - 1]
    })
  };
}

export function findDateIndex(text, targetDate) {
  const normalized = normalizeText(text);

  return targetDate.patterns.reduce((best, pattern) => {
    const match = pattern.exec(normalized);
    if (!match) {
      return best;
    }

    return best === -1 ? match.index : Math.min(best, match.index);
  }, -1);
}

export function classifyEventDate(text, targetDates) {
  const matches = targetDates
    .map((targetDate) => ({
      date: targetDate,
      index: findDateIndex(text, targetDate)
    }))
    .filter((match) => match.index !== -1)
    .sort((a, b) => a.index - b.index);

  return matches[0]?.date ?? null;
}

export function extractEntryFee(text) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const scoredLines = lines.map((line, index) => ({
    line,
    index,
    score: scoreFeeLine(line)
  }));

  const exactFeeLine = scoredLines
    .filter((item) => item.score >= 80)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];

  if (exactFeeLine) {
    return {
      value: compactFeeEvidence(exactFeeLine.line),
      confidence: 'high',
      evidence: exactFeeLine.line
    };
  }

  const usefulLine = scoredLines
    .filter((item) => item.score >= 60)
    .sort((a, b) => b.score - a.score || a.index - b.index)[0];

  if (usefulLine) {
    const context = lines
      .slice(Math.max(0, usefulLine.index - 1), Math.min(lines.length, usefulLine.index + 2))
      .join(' ');

    return {
      value: compactFeeEvidence(context),
      confidence: 'medium',
      evidence: context
    };
  }

  return {
    value: '?',
    confidence: 'unknown',
    evidence: ''
  };
}

export function escapeMarkdownTableCell(value) {
  return String(value ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

export function escapeMarkdownLinkText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .trim();
}

function buildDatePatterns({ year, month, day, monthName, monthShort, huMonth, huMonthShort }) {
  const dd = String(day).padStart(2, '0');
  const mm = String(month).padStart(2, '0');
  const dayPattern = `0?${day}`;
  const monthPattern = `0?${month}`;

  return [
    new RegExp(`\\b${monthName}\\s+${dayPattern}(?:\\b|\\D)`),
    new RegExp(`\\b${monthShort}\\.?\\s+${dayPattern}(?:\\b|\\D)`),
    new RegExp(`\\b${dayPattern}\\s+${monthName}\\b`),
    new RegExp(`\\b${dayPattern}\\s+${monthShort}\\.?\\b`),
    new RegExp(`\\b${huMonth}\\s+${dayPattern}\\.?\\b`),
    new RegExp(`\\b${huMonthShort}\\.?\\s+${dayPattern}\\.?\\b`),
    new RegExp(`\\b${year}\\.\\s*${huMonth}\\s+${dayPattern}\\.?\\b`),
    new RegExp(`\\b${year}\\.\\s*${huMonthShort}\\.?\\s+${dayPattern}\\.?\\b`),
    new RegExp(`\\b${year}\\.\\s*${monthPattern}\\.\\s*${dayPattern}\\.?\\b`),
    new RegExp(`\\b${year}-${mm}-${dd}\\b`),
    new RegExp(`\\b${monthPattern}/${dayPattern}/${year}\\b`),
    new RegExp(`\\b${dayPattern}/${monthPattern}/${year}\\b`)
  ];
}

function scoreFeeLine(line) {
  const normalized = normalizeText(line);
  let score = 0;

  if (/\b(?:no cover|free entry|free admission|admission free|ingyenes?|dijmentes)\b/.test(normalized)) {
    score += 90;
  }

  if (/\b(?:belepo|belepes|jegy|jegyek|ticket|tickets|entry|admission|door|elovetel|early bird|presale)\b/.test(normalized)) {
    score += 35;
  }

  if (/\b(?:huf|ft|forint)\b/.test(normalized) || /\d[\d .\/]*(?:,-)?\s*(?:ft|huf|forint)\b/.test(normalized)) {
    score += 70;
  }

  if (/\b(?:buy tickets|tickets available|jegyvasarlas|jegylink)\b/.test(normalized)) {
    score += 30;
  }

  if (normalized.length > 220) {
    score -= 20;
  }

  return score;
}

function compactFeeEvidence(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();

  if (/\b(?:no cover|free entry|free admission|admission free)\b/i.test(text)) {
    return 'Free';
  }

  if (/\b(?:ingyenes|ingyen|dijmentes)\b/i.test(normalizeText(text))) {
    return 'Ingyenes';
  }

  const priceMatches = [
    ...text.matchAll(/\b\d[\d .\/]*(?:,-)?\s*(?:Ft|HUF|forint)\b/gi),
    ...text.matchAll(/\b(?:Ft|HUF)\s*\d[\d .\/]*\b/gi)
  ].map((match) => match[0].trim());

  if (priceMatches.length > 0) {
    return [...new Set(priceMatches)].join(', ');
  }

  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}
