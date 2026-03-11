/**
 * Crawl community mentions for businesses across 6 sources.
 * Upserts results into CommunityMention table.
 *
 * Run: npx tsx scripts/crawl-community-mentions.ts --limit 100
 */

import { PrismaClient } from '@prisma/client';
import * as cheerio from 'cheerio';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REQUEST_DELAY_MS = 2000;
const MAX_RETRIES = 3;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns true if the string contains at least one Korean character. */
function hasKorean(s: string): boolean {
  return /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F\uA960-\uA97F\uD7B0-\uD7FF]/.test(s);
}

/** Parse --limit from CLI args (default 5000). */
function parseLimit(): number {
  const idx = process.argv.indexOf('--limit');
  if (idx !== -1 && process.argv[idx + 1]) {
    const n = parseInt(process.argv[idx + 1], 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 5000;
}

/** Fetch with retries, delay, and User-Agent header. */
async function fetchWithRetry(
  url: string,
  retries = MAX_RETRIES,
): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      return await res.text();
    } catch (err: any) {
      console.warn(
        `  [retry ${attempt}/${retries}] ${url.slice(0, 80)}... — ${err.message}`,
      );
      if (attempt < retries) await sleep(1000 * attempt);
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Source crawlers
// ---------------------------------------------------------------------------

interface CrawlResult {
  source: string;
  mentionCount: number;
  externalRating?: number;
  externalReviewCount?: number;
}

/** 1. radiokorea.com — bulletin board search */
async function crawlRadioKorea(name: string): Promise<CrawlResult> {
  const url = `https://www.radiokorea.com/bulletin/bbs/search.php?stx=${encodeURIComponent(name)}`;
  const html = await fetchWithRetry(url);
  let mentionCount = 0;
  if (html) {
    const $ = cheerio.load(html);
    // Count search result items — typical patterns: .search-list li, .bbs_list tr, search result entries
    const resultItems =
      $('table.bbs_list tbody tr').length ||
      $('ul.search-list li').length ||
      $('div.search-result').length ||
      $('div.search_result').length ||
      $('li.list-item').length;
    // Fallback: count links that look like article links
    if (resultItems > 0) {
      mentionCount = resultItems;
    } else {
      // Try to extract a "results found" text like "총 123건"
      const bodyText = $('body').text();
      const match = bodyText.match(/(?:총|결과|검색결과)\s*[:：]?\s*(\d[\d,]*)\s*(?:건|개|results)/i);
      if (match) {
        mentionCount = parseInt(match[1].replace(/,/g, ''), 10);
      } else {
        // Count all links in the main content area as rough estimate
        mentionCount = $('a[href*="bulletin"]').length || $('a[href*="bbs"]').length;
      }
    }
  }
  return { source: 'radiokorea', mentionCount };
}

/** 2. heykorean.com — search */
async function crawlHeyKorean(name: string): Promise<CrawlResult> {
  const url = `https://heykorean.com/search?keyword=${encodeURIComponent(name)}`;
  const html = await fetchWithRetry(url);
  let mentionCount = 0;
  if (html) {
    const $ = cheerio.load(html);
    // Try to find result count text
    const bodyText = $('body').text();
    const match = bodyText.match(/(\d[\d,]*)\s*(?:건|개|results|개의\s*결과)/i);
    if (match) {
      mentionCount = parseInt(match[1].replace(/,/g, ''), 10);
    } else {
      // Count search result list items
      mentionCount =
        $('div.search-result-item').length ||
        $('li.search-item').length ||
        $('div.result-item').length ||
        $('article').length ||
        $('div.list-item').length;
    }
  }
  return { source: 'heykorean', mentionCount };
}

/** 3. missyusa.com — search */
async function crawlMissyUSA(name: string): Promise<CrawlResult> {
  const url = `https://www.missyusa.com/search?q=${encodeURIComponent(name)}`;
  const html = await fetchWithRetry(url);
  let mentionCount = 0;
  if (html) {
    const $ = cheerio.load(html);
    const bodyText = $('body').text();
    const match = bodyText.match(/(\d[\d,]*)\s*(?:건|개|results|개의\s*결과)/i);
    if (match) {
      mentionCount = parseInt(match[1].replace(/,/g, ''), 10);
    } else {
      mentionCount =
        $('div.search-result').length ||
        $('li.search-result-item').length ||
        $('table.board_list tbody tr').length ||
        $('div.result-item').length ||
        $('article').length;
    }
  }
  return { source: 'missyusa', mentionCount };
}

/** 4. Yelp — search by name + location */
async function crawlYelp(
  name: string,
  city: string,
  state: string,
): Promise<CrawlResult> {
  const url = `https://www.yelp.com/search?find_desc=${encodeURIComponent(name)}&find_loc=${encodeURIComponent(city)},${encodeURIComponent(state)}`;
  const html = await fetchWithRetry(url);
  let mentionCount = 0;
  let externalRating: number | undefined;
  let externalReviewCount: number | undefined;

  if (html) {
    const $ = cheerio.load(html);
    // Try to find the first result's rating and review count
    // Yelp uses aria-label on rating elements like "4.5 star rating"
    const ratingEl = $('[aria-label*="star rating"]').first();
    if (ratingEl.length) {
      const ratingMatch = ratingEl.attr('aria-label')?.match(/([\d.]+)\s*star/);
      if (ratingMatch) {
        externalRating = parseFloat(ratingMatch[1]);
      }
    }

    // Review count — often in text like "123 reviews"
    const bodyText = $('body').text();
    const reviewMatch = bodyText.match(/(\d[\d,]*)\s*reviews?/i);
    if (reviewMatch) {
      externalReviewCount = parseInt(reviewMatch[1].replace(/,/g, ''), 10);
    }

    // Count search result cards
    mentionCount =
      $('[data-testid="serp-ia-card"]').length ||
      $('div[class*="searchResult"]').length ||
      $('li[class*="border-color"]').length ||
      $('div.search-result').length;

    // Fallback: count result items by heading pattern
    if (mentionCount === 0) {
      mentionCount = $('h3 a[href*="/biz/"]').length;
    }
  }

  return {
    source: 'yelp',
    mentionCount,
    externalRating,
    externalReviewCount,
  };
}

/** 5. Instagram (via Google search) — estimate result count */
async function crawlInstagram(name: string): Promise<CrawlResult> {
  const url = `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com ${name}`)}`;
  const html = await fetchWithRetry(url);
  let mentionCount = 0;
  if (html) {
    const $ = cheerio.load(html);
    // Google shows "About 1,234 results" in the result stats div
    const statsText = $('#result-stats').text() || $('div.LHJvCe').text() || '';
    const match = statsText.match(/(?:About|약)\s*([\d,]+)\s*(?:results|개)/i);
    if (match) {
      mentionCount = parseInt(match[1].replace(/,/g, ''), 10);
    } else {
      // Count actual search result links
      mentionCount = $('div.g').length || $('div[data-sokoban-container]').length;
    }
  }
  return { source: 'instagram', mentionCount };
}

/** 6. Reddit — JSON API */
async function crawlReddit(name: string): Promise<CrawlResult> {
  const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(name)}&limit=100`;
  let mentionCount = 0;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const json = (await res.json()) as any;
      mentionCount = json?.data?.dist ?? 0;
    }
  } catch (err: any) {
    console.warn(`  Reddit fetch failed: ${err.message}`);
  }
  return { source: 'reddit', mentionCount };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface BusinessRow {
  id: number;
  nameKo: string;
  nameEn: string | null;
  city: string;
  state: string;
  googlePlace: { userRatingsTotal: number | null } | null;
}

async function main() {
  const limit = parseLimit();
  console.log(`\n=== Community Mention Crawler ===`);
  console.log(`Limit: ${limit}\n`);

  // Fetch eligible businesses:
  // WHERE googlePlace.userRatingsTotal > 5 OR nameKo contains Korean chars
  // ORDER BY userRatingsTotal DESC
  const businesses: BusinessRow[] = await prisma.$queryRaw`
    SELECT
      b.id,
      b."nameKo",
      b."nameEn",
      b.city,
      b.state,
      gp."userRatingsTotal" AS "gpRatings"
    FROM "Business" b
    LEFT JOIN "GooglePlace" gp ON gp."businessId" = b.id
    WHERE gp."userRatingsTotal" > 5
       OR b."nameKo" ~ '[\uAC00-\uD7AF]'
    ORDER BY COALESCE(gp."userRatingsTotal", 0) DESC
    LIMIT ${limit}
  ` as any[];

  // Reshape into expected format
  const shaped: BusinessRow[] = businesses.map((row: any) => ({
    id: row.id,
    nameKo: row.nameKo,
    nameEn: row.nameEn,
    city: row.city,
    state: row.state,
    googlePlace: row.gpRatings != null ? { userRatingsTotal: row.gpRatings } : null,
  }));

  console.log(`Found ${shaped.length} businesses to crawl.\n`);

  let processed = 0;
  let totalUpserts = 0;
  let totalErrors = 0;

  for (const biz of shaped) {
    processed++;
    const searchName = biz.nameKo;
    const bizId = String(biz.id);

    if (processed % 100 === 0 || processed === 1) {
      console.log(
        `[${processed}/${shaped.length}] Processing: ${searchName} (id=${biz.id})`,
      );
    }

    // Crawl all 6 sources
    const crawlers: Array<() => Promise<CrawlResult>> = [
      () => crawlRadioKorea(searchName),
      () => crawlHeyKorean(searchName),
      () => crawlMissyUSA(searchName),
      () => crawlYelp(biz.nameEn || searchName, biz.city, biz.state),
      () => crawlInstagram(searchName),
      () => crawlReddit(biz.nameEn || searchName),
    ];

    for (const crawl of crawlers) {
      try {
        const result = await crawl();

        await prisma.communityMention.upsert({
          where: {
            businessId_source: {
              businessId: bizId,
              source: result.source,
            },
          },
          create: {
            businessId: bizId,
            source: result.source,
            mentionCount: result.mentionCount,
            externalRating: result.externalRating ?? null,
            externalReviewCount: result.externalReviewCount ?? null,
            lastCrawledAt: new Date(),
          },
          update: {
            mentionCount: result.mentionCount,
            externalRating: result.externalRating ?? null,
            externalReviewCount: result.externalReviewCount ?? null,
            lastCrawledAt: new Date(),
          },
        });

        totalUpserts++;

        // 2-second delay between requests
        await sleep(REQUEST_DELAY_MS);
      } catch (err: any) {
        totalErrors++;
        console.warn(
          `  [ERROR] ${searchName} / source failed: ${err.message}`,
        );
        // Skip this source, continue with next
      }
    }
  }

  console.log(`\n=== Crawl Complete ===`);
  console.log(`Businesses processed: ${processed}`);
  console.log(`Upserts: ${totalUpserts}`);
  console.log(`Errors (skipped): ${totalErrors}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Community mention crawl failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
