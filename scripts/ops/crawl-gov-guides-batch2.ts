/**
 * crawl-gov-guides-batch2.ts
 *
 * 가이드 6~10번 원본 콘텐츠 크롤링
 * 대상: CA DMV, CA EDD, SBA, FTC, CA Tenant Rights
 *
 * Usage: npx tsx scripts/crawl-gov-guides-batch2.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import * as cheerio from 'cheerio';

const OUT_DIR = resolve(__dirname, '../data/raw-guides');
mkdirSync(OUT_DIR, { recursive: true });

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const RETRY_COUNT = 3;
const RETRY_DELAY_MS = 2000;

interface GuideSource {
  fileName: string;
  urls: string[];
}

const SOURCES: GuideSource[] = [
  {
    fileName: 'ca-dmv-drivers-license.txt',
    urls: [
      'https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/',
      'https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/applying-for-a-dl-702/',
      'https://www.dmv.ca.gov/portal/vehicle-registration/',
      'https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/real-id/',
    ],
  },
  {
    fileName: 'ca-unemployment-benefits.txt',
    urls: [
      'https://edd.ca.gov/en/unemployment/Filing_a_Claim/',
      'https://edd.ca.gov/en/unemployment/eligibility/',
      'https://edd.ca.gov/en/unemployment/FAQ_-_Filing_a_Claim/',
    ],
  },
  {
    fileName: 'sba-small-business.txt',
    urls: [
      'https://www.sba.gov/business-guide/plan-your-business/write-your-business-plan',
      'https://www.sba.gov/business-guide/launch-your-business/choose-business-structure',
      'https://www.sba.gov/business-guide/launch-your-business/get-federal-and-state-tax-id-numbers',
      'https://www.sba.gov/business-guide/launch-your-business/apply-for-licenses-and-permits',
    ],
  },
  {
    fileName: 'ftc-scam-prevention.txt',
    urls: [
      'https://consumer.ftc.gov/features/scam-alerts',
      'https://consumer.ftc.gov/articles/what-know-about-romance-scams',
      'https://consumer.ftc.gov/articles/how-avoid-scam',
      'https://consumer.ftc.gov/articles/job-scams',
    ],
  },
  {
    fileName: 'ca-tenant-rights.txt',
    urls: [
      'https://oag.ca.gov/consumers/general/landlord-tenant',
      'https://www.hud.gov/topics/rental_assistance',
      'https://dcba.lacounty.gov/renters-rights/',
    ],
  },
];

function extractText(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $(
    'script, style, nav, footer, header, aside, .sidebar, .nav, .footer, .header, #sidebar, #nav, #footer, #header, noscript, iframe, svg, [role="navigation"], [role="banner"], [role="contentinfo"]'
  ).remove();

  // Try to find main content area
  let content = $('main').first();
  if (!content.length) content = $('article').first();
  if (!content.length) content = $('[role="main"]').first();
  if (!content.length) content = $('#main-content').first();
  if (!content.length) content = $('.main-content').first();
  if (!content.length) content = $('#content').first();
  if (!content.length) content = $('body');

  // Get text and clean up
  let text = content.text();

  // Normalize whitespace
  text = text
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  return text;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(url: string): Promise<string | null> {
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      console.log(`  Fetching (attempt ${attempt}/${RETRY_COUNT}): ${url}`);
      const resp = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      if (!resp.ok) {
        console.error(`  HTTP ${resp.status} for ${url}`);
        if (attempt < RETRY_COUNT) {
          await sleep(RETRY_DELAY_MS);
          continue;
        }
        return null;
      }

      return await resp.text();
    } catch (err: any) {
      console.error(`  Fetch error for ${url}: ${err.message}`);
      if (attempt < RETRY_COUNT) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }
      return null;
    }
  }
  return null;
}

async function main() {
  console.log('=== .gov Guide Crawling — Batch 2 (Guides 6-10) ===\n');

  for (const source of SOURCES) {
    console.log(`[${source.fileName}]`);
    const parts: string[] = [`# Source URLs\n`];

    for (const url of source.urls) {
      parts.push(`- ${url}`);
    }
    parts.push('\n---\n');

    let successCount = 0;

    for (const url of source.urls) {
      // Add delay between requests to avoid bot blocking
      if (successCount > 0 || parts.length > 4) {
        await sleep(RETRY_DELAY_MS);
      }

      const html = await fetchPage(url);
      if (!html) {
        parts.push(`\n[FAILED] ${url}\n`);
        console.log(`  ⚠ Skipped: ${url}`);
        continue;
      }

      const text = extractText(html);
      if (text.length < 100) {
        console.log(
          `  Warning: Very short content from ${url} (${text.length} chars)`
        );
      }

      parts.push(`\n## Source: ${url}\n`);
      parts.push(text);
      parts.push('\n');
      successCount++;
    }

    const outPath = resolve(OUT_DIR, source.fileName);
    writeFileSync(outPath, parts.join('\n'), 'utf-8');
    console.log(
      `  → Saved: ${outPath} (${successCount}/${source.urls.length} URLs)\n`
    );
  }

  console.log('=== Done ===');
}

main().catch(console.error);
