/**
 * Crawl alert feeds from 4 government/agency sources.
 * Run: npx tsx scripts/crawl-alert-feeds.ts
 *
 * Sources:
 *   1. Visa Bulletin (travel.state.gov)
 *   2. USCIS News (uscis.gov)
 *   3. FDA Food Recalls (api.fda.gov)
 *   4. IRS News (irs.gov)
 *
 * All new alerts are saved with status="draft".
 */

import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const DELAY_MS = 2000;
const MAX_RETRIES = 3;

// ─── Helpers ───

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(url: string, retries = MAX_RETRIES): Promise<string> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      console.warn(`  Attempt ${attempt}/${retries} failed for ${url}:`, (err as Error).message);
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
  throw new Error('unreachable');
}

async function fetchJsonWithRetry(url: string, retries = MAX_RETRIES): Promise<any> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (err) {
      console.warn(`  Attempt ${attempt}/${retries} failed for ${url}:`, (err as Error).message);
      if (attempt === retries) throw err;
      await sleep(1000 * attempt);
    }
  }
  throw new Error('unreachable');
}

interface AlertDraft {
  slug: string;
  source: string;
  titleKo: string;
  titleEn?: string;
  summaryKo: string;
  contentKo?: string;
  sourceUrl: string;
  severity: string;
  categorySlug?: string;
  publishedAt: Date;
}

async function saveAlerts(alerts: AlertDraft[]): Promise<number> {
  let saved = 0;
  for (const alert of alerts) {
    // Skip if slug already exists
    const existing = await prisma.alertFeed.findUnique({
      where: { slug: alert.slug },
    });
    if (existing) {
      console.log(`  [skip] ${alert.slug} already exists`);
      continue;
    }

    await prisma.alertFeed.create({
      data: {
        slug: alert.slug,
        source: alert.source,
        titleKo: alert.titleKo,
        titleEn: alert.titleEn ?? null,
        summaryKo: alert.summaryKo,
        contentKo: alert.contentKo ?? null,
        sourceUrl: alert.sourceUrl,
        severity: alert.severity,
        categorySlug: alert.categorySlug ?? null,
        publishedAt: alert.publishedAt,
        status: 'draft',
      },
    });
    console.log(`  [saved] ${alert.slug}`);
    saved++;
  }
  return saved;
}

// ─── 1. Visa Bulletin ───

async function crawlVisaBulletin(): Promise<AlertDraft[]> {
  console.log('\n=== Visa Bulletin ===');
  const baseUrl = 'https://travel.state.gov';
  const indexUrl = `${baseUrl}/content/travel/en/legal/visa-law0/visa-bulletin.html`;

  const html = await fetchWithRetry(indexUrl);
  const $ = cheerio.load(html);

  // Find the latest bulletin link
  const bulletinLinks: { href: string; text: string }[] = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();
    if (
      href.includes('/visa-bulletin/') &&
      !href.endsWith('/visa-bulletin.html') &&
      text.match(/visa\s+bulletin\s+for\s+/i)
    ) {
      bulletinLinks.push({ href, text });
    }
  });

  if (bulletinLinks.length === 0) {
    console.log('  No bulletin links found');
    return [];
  }

  // Get the first (latest) bulletin
  const latest = bulletinLinks[0];
  const bulletinUrl = latest.href.startsWith('http')
    ? latest.href
    : `${baseUrl}${latest.href}`;

  console.log(`  Latest bulletin: ${latest.text}`);
  await sleep(DELAY_MS);

  const bulletinHtml = await fetchWithRetry(bulletinUrl);
  const $b = cheerio.load(bulletinHtml);

  // Parse EB dates from Employment-Based table
  // Look for "All Chargeability Areas" row for EB categories
  let ebDates: Record<string, string> = {};
  $b('table').each((_, table) => {
    const tableText = $b(table).text();
    if (tableText.includes('Employment') && (tableText.includes('1st') || tableText.includes('EB-1') || tableText.includes('Final Action'))) {
      const rows = $b(table).find('tr');
      rows.each((_, row) => {
        const cells = $b(row).find('td, th');
        const firstCell = $b(cells[0]).text().trim().toLowerCase();
        if (
          firstCell.includes('1st') ||
          firstCell.includes('2nd') ||
          firstCell.includes('3rd') ||
          firstCell.includes('eb-1') ||
          firstCell.includes('eb-2') ||
          firstCell.includes('eb-3')
        ) {
          // "All Chargeability Areas" is usually the 2nd column
          const allChargeCell = $b(cells[1]).text().trim();
          const category = firstCell.includes('1st') || firstCell.includes('eb-1')
            ? 'EB-1'
            : firstCell.includes('2nd') || firstCell.includes('eb-2')
              ? 'EB-2'
              : 'EB-3';
          if (allChargeCell && !ebDates[category]) {
            ebDates[category] = allChargeCell;
          }
        }
      });
    }
  });

  // Parse month/year from the bulletin title
  const monthMatch = latest.text.match(
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})/i
  );
  const monthNames: Record<string, number> = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };

  let year = new Date().getFullYear();
  let month = new Date().getMonth() + 1;
  if (monthMatch) {
    const monthName = latest.text.match(
      /(January|February|March|April|May|June|July|August|September|October|November|December)/i
    );
    if (monthName) {
      month = monthNames[monthName[1].toLowerCase()] || month;
    }
    year = parseInt(monthMatch[1], 10);
  }

  const slug = `visa-bulletin-${year}-${String(month).padStart(2, '0')}`;

  const ebSummary = Object.entries(ebDates)
    .map(([cat, date]) => `${cat}: ${date}`)
    .join(', ');

  const titleKo = `${year}년 ${month}월 비자 불러틴 — ${ebSummary || 'EB 날짜 확인'}`;

  const summaryKo = ebSummary
    ? `${year}년 ${month}월 미국 취업이민 비자 불러틴이 발표되었습니다. All Chargeability Areas 기준: ${ebSummary}. 자세한 내용은 원문을 확인하세요.`
    : `${year}년 ${month}월 미국 비자 불러틴이 발표되었습니다. 취업이민 각 카테고리별 날짜는 원문에서 확인하세요.`;

  console.log(`  EB dates: ${ebSummary || 'none parsed'}`);

  return [
    {
      slug,
      source: 'visa_bulletin',
      titleKo,
      titleEn: latest.text,
      summaryKo,
      sourceUrl: bulletinUrl,
      severity: 'info',
      categorySlug: 'legal',
      publishedAt: new Date(year, month - 1, 1),
    },
  ];
}

// ─── 2. USCIS News ───

const USCIS_KEYWORDS = [
  'h-1b', 'employment', 'green card', 'visa', 'tps', 'daca',
  'naturalization', 'fraud', 'immigration', 'work permit', 'ead',
];

function uscisSlugify(title: string): string {
  return 'uscis-' + title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function translateUscisTitle(title: string): string {
  // Simple keyword-based Korean title generation
  const lower = title.toLowerCase();

  if (lower.includes('h-1b')) return `[USCIS] H-1B 비자 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('green card')) return `[USCIS] 영주권 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('tps')) return `[USCIS] TPS(임시보호신분) 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('daca')) return `[USCIS] DACA 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('naturalization') || lower.includes('citizenship'))
    return `[USCIS] 시민권/귀화 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('fraud')) return `[USCIS] 이민 사기 경보: ${title.slice(0, 60)}`;
  if (lower.includes('visa')) return `[USCIS] 비자 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('employment') || lower.includes('work'))
    return `[USCIS] 취업이민 관련 소식: ${title.slice(0, 60)}`;

  return `[USCIS] 이민 뉴스: ${title.slice(0, 60)}`;
}

async function crawlUscisNews(): Promise<AlertDraft[]> {
  console.log('\n=== USCIS News ===');
  const url = 'https://www.uscis.gov/newsroom/all-news';

  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  const alerts: AlertDraft[] = [];
  const items: { title: string; href: string; date: string }[] = [];

  // USCIS news page has various list/card layouts
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();

    // Look for news item links
    if (
      href.startsWith('/newsroom/') &&
      !href.endsWith('/all-news') &&
      !href.endsWith('/newsroom') &&
      text.length > 20 &&
      text.length < 300
    ) {
      items.push({ title: text, href, date: '' });
    }
  });

  // Also try structured news items with date info
  $('.views-row, .news-item, article, .usa-collection__item').each((_, el) => {
    const link = $(el).find('a').first();
    const href = link.attr('href') || '';
    const title = link.text().trim();
    const dateEl = $(el).find('time, .date, .datetime, .news-date').first();
    const date = dateEl.attr('datetime') || dateEl.text().trim();

    if (href && title && title.length > 10) {
      items.push({ title, href, date });
    }
  });

  // Deduplicate by href
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });

  // Filter by keywords, take up to 5
  const filtered = unique
    .filter((item) => {
      const lower = item.title.toLowerCase();
      return USCIS_KEYWORDS.some((kw) => lower.includes(kw));
    })
    .slice(0, 5);

  console.log(`  Found ${unique.length} news items, ${filtered.length} match keywords`);

  for (const item of filtered) {
    const fullUrl = item.href.startsWith('http')
      ? item.href
      : `https://www.uscis.gov${item.href}`;

    const slug = uscisSlugify(item.title);
    const titleKo = translateUscisTitle(item.title);

    // Try to parse date
    let publishedAt = new Date();
    if (item.date) {
      const parsed = new Date(item.date);
      if (!isNaN(parsed.getTime())) publishedAt = parsed;
    }

    // Determine severity
    const lower = item.title.toLowerCase();
    let severity = 'info';
    if (lower.includes('fraud') || lower.includes('alert') || lower.includes('warning')) {
      severity = 'warning';
    }

    alerts.push({
      slug,
      source: 'uscis',
      titleKo,
      titleEn: item.title,
      summaryKo: `${titleKo}. 자세한 내용은 USCIS 원문을 확인하세요.`,
      sourceUrl: fullUrl,
      severity,
      categorySlug: 'legal',
      publishedAt,
    });
  }

  return alerts;
}

// ─── 3. FDA Food Recall ───

const FDA_KOREAN_KEYWORDS = [
  'korean', 'kimchi', 'ramen', 'noodle', 'tofu', 'rice', 'sesame',
  'gochujang', 'enoki', 'bean sprout', 'bibim', 'bulgogi', 'mandu',
  'dumpling', 'seaweed', 'soy sauce', 'banchan',
];

function fdaSeverity(classification: string): string {
  if (classification.includes('I') && !classification.includes('II') && !classification.includes('III')) {
    return 'urgent';
  }
  if (classification.includes('II') && !classification.includes('III')) {
    return 'warning';
  }
  return 'info';
}

async function crawlFdaRecalls(): Promise<AlertDraft[]> {
  console.log('\n=== FDA Food Recalls ===');
  const url =
    'https://api.fda.gov/food/enforcement.json?limit=20&sort=report_date:desc';

  const data = await fetchJsonWithRetry(url);
  const results = data?.results || [];

  console.log(`  Fetched ${results.length} recall records`);

  const alerts: AlertDraft[] = [];

  for (const item of results) {
    const firm = (item.recalling_firm || '').toLowerCase();
    const product = (item.product_description || '').toLowerCase();
    const combined = `${firm} ${product}`;

    const isKoreanRelated = FDA_KOREAN_KEYWORDS.some((kw) =>
      combined.includes(kw)
    );

    if (!isKoreanRelated) continue;

    const recallNumber = item.recall_number || `fda-${Date.now()}`;
    const slug = `fda-recall-${recallNumber.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const productShort =
      (item.product_description || 'Unknown product').slice(0, 80);
    const reason = (item.reason_for_recall || 'Unknown reason').slice(0, 80);

    const classification = item.classification || 'Class III';
    const severity = fdaSeverity(classification);

    const titleKo = `[FDA 리콜] ${productShort} — ${reason}`;
    const summaryKo = `리콜 업체: ${item.recalling_firm || 'N/A'}. 분류: ${classification}. ${reason}. 유통 지역: ${item.distribution_pattern || 'N/A'}.`;

    let publishedAt = new Date();
    if (item.report_date) {
      // FDA dates are YYYYMMDD format
      const dateStr = item.report_date;
      const parsed = new Date(
        `${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`
      );
      if (!isNaN(parsed.getTime())) publishedAt = parsed;
    }

    alerts.push({
      slug,
      source: 'fda_recall',
      titleKo,
      titleEn: `FDA Recall: ${productShort}`,
      summaryKo,
      sourceUrl: `https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts`,
      severity,
      categorySlug: 'food',
      publishedAt,
    });
  }

  console.log(`  ${alerts.length} Korean-related recalls found`);
  return alerts;
}

// ─── 4. IRS News ───

const IRS_KEYWORDS = [
  'filing', 'deadline', 'refund', 'credit', 'itin', 'fbar', 'foreign',
  'extension', 'tax', 'payment', 'eitc', 'stimulus', 'penalty',
];

function translateIrsTitle(title: string): string {
  const lower = title.toLowerCase();

  if (lower.includes('filing') || lower.includes('deadline'))
    return `[IRS] 세금 신고 마감 관련: ${title.slice(0, 60)}`;
  if (lower.includes('refund')) return `[IRS] 환급 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('credit') || lower.includes('eitc'))
    return `[IRS] 세금 공제/크레딧 소식: ${title.slice(0, 60)}`;
  if (lower.includes('itin')) return `[IRS] ITIN 관련 소식: ${title.slice(0, 60)}`;
  if (lower.includes('fbar') || lower.includes('foreign'))
    return `[IRS] 해외자산 보고 관련: ${title.slice(0, 60)}`;
  if (lower.includes('extension')) return `[IRS] 신고 연장 관련: ${title.slice(0, 60)}`;
  if (lower.includes('payment')) return `[IRS] 세금 납부 관련: ${title.slice(0, 60)}`;

  return `[IRS] 세금 뉴스: ${title.slice(0, 60)}`;
}

async function crawlIrsNews(): Promise<AlertDraft[]> {
  console.log('\n=== IRS News ===');
  const url = 'https://www.irs.gov/newsroom';

  const html = await fetchWithRetry(url);
  const $ = cheerio.load(html);

  const items: { title: string; href: string; date: string }[] = [];

  // IRS newsroom uses structured list items
  $('a').each((_, el) => {
    const href = $(el).attr('href') || '';
    const text = $(el).text().trim();

    if (
      (href.startsWith('/newsroom/') || href.startsWith('https://www.irs.gov/newsroom/')) &&
      !href.endsWith('/newsroom') &&
      text.length > 15 &&
      text.length < 300
    ) {
      items.push({ title: text, href, date: '' });
    }
  });

  // Try structured items
  $('.views-row, .news-item, article, li').each((_, el) => {
    const link = $(el).find('a').first();
    const href = link.attr('href') || '';
    const title = link.text().trim();
    const dateEl = $(el).find('time, .date, .datetime').first();
    const date = dateEl.attr('datetime') || dateEl.text().trim();

    if (
      href &&
      title &&
      title.length > 15 &&
      (href.includes('/newsroom/') || href.includes('irs.gov'))
    ) {
      items.push({ title, href, date });
    }
  });

  // Deduplicate
  const seen = new Set<string>();
  const unique = items.filter((item) => {
    if (seen.has(item.href)) return false;
    seen.add(item.href);
    return true;
  });

  // Filter by keywords, take up to 10
  const filtered = unique
    .filter((item) => {
      const lower = item.title.toLowerCase();
      return IRS_KEYWORDS.some((kw) => lower.includes(kw));
    })
    .slice(0, 10);

  console.log(`  Found ${unique.length} news items, ${filtered.length} match keywords`);

  const alerts: AlertDraft[] = [];

  for (const item of filtered) {
    const fullUrl = item.href.startsWith('http')
      ? item.href
      : `https://www.irs.gov${item.href}`;

    const slug =
      'irs-' +
      item.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80);

    const titleKo = translateIrsTitle(item.title);

    let publishedAt = new Date();
    if (item.date) {
      const parsed = new Date(item.date);
      if (!isNaN(parsed.getTime())) publishedAt = parsed;
    }

    // Determine severity
    const lower = item.title.toLowerCase();
    let severity = 'info';
    if (lower.includes('deadline') || lower.includes('penalty')) {
      severity = 'warning';
    }

    alerts.push({
      slug,
      source: 'irs',
      titleKo,
      titleEn: item.title,
      summaryKo: `${titleKo}. 자세한 내용은 IRS 원문을 확인하세요.`,
      sourceUrl: fullUrl,
      severity,
      categorySlug: 'financial',
      publishedAt,
    });
  }

  return alerts;
}

// ─── Main ───

async function main() {
  console.log('Alert Feed Crawler starting...');
  console.log(`Time: ${new Date().toISOString()}`);

  let totalSaved = 0;

  try {
    // 1. Visa Bulletin
    const visaAlerts = await crawlVisaBulletin();
    totalSaved += await saveAlerts(visaAlerts);
    await sleep(DELAY_MS);

    // 2. USCIS News
    const uscisAlerts = await crawlUscisNews();
    totalSaved += await saveAlerts(uscisAlerts);
    await sleep(DELAY_MS);

    // 3. FDA Food Recalls
    const fdaAlerts = await crawlFdaRecalls();
    totalSaved += await saveAlerts(fdaAlerts);
    await sleep(DELAY_MS);

    // 4. IRS News
    const irsAlerts = await crawlIrsNews();
    totalSaved += await saveAlerts(irsAlerts);

    console.log(`\n=== Done ===`);
    console.log(`Total new alerts saved: ${totalSaved}`);
  } catch (err) {
    console.error('Crawl failed:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
