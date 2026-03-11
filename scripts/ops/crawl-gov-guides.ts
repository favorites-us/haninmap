/**
 * crawl-gov-guides.ts
 *
 * .gov 사이트에서 가이드 원본 콘텐츠를 텍스트로 추출하여 data/raw-guides/ 에 저장
 *
 * Usage: npx tsx scripts/crawl-gov-guides.ts
 */

import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';
import * as cheerio from 'cheerio';

const OUT_DIR = resolve(__dirname, '../data/raw-guides');
mkdirSync(OUT_DIR, { recursive: true });

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

interface GuideSource {
  fileName: string;
  urls: string[];
}

const SOURCES: GuideSource[] = [
  {
    fileName: 'irs-tax-filing.txt',
    urls: [
      'https://www.irs.gov/filing',
      'https://www.irs.gov/credits-deductions/individuals',
    ],
  },
  {
    fileName: 'uscis-immigration.txt',
    urls: [
      'https://www.uscis.gov/green-card',
      'https://www.uscis.gov/working-in-the-united-states',
      'https://www.uscis.gov/citizenship/learn-about-citizenship',
    ],
  },
  {
    fileName: 'healthcare-insurance.txt',
    urls: [
      'https://www.healthcare.gov/choose-a-plan/',
      'https://www.healthcare.gov/immigrants/',
      'https://www.medicare.gov/basics/get-started-with-medicare',
    ],
  },
  {
    fileName: 'new-immigrant-settlement.txt',
    urls: [
      'https://www.usa.gov/newcomers',
      'https://www.uscis.gov/tools/settling-in-the-us',
    ],
  },
  {
    fileName: 'home-buying.txt',
    urls: [
      'https://www.consumerfinance.gov/owning-a-home/',
      'https://www.hud.gov/topics/buying_a_home',
    ],
  },
];

function extractText(html: string, url: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $('script, style, nav, footer, header, aside, .sidebar, .nav, .footer, .header, #sidebar, #nav, #footer, #header, noscript, iframe, svg, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();

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

async function fetchPage(url: string): Promise<string | null> {
  try {
    console.log(`  Fetching: ${url}`);
    const resp = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!resp.ok) {
      console.error(`  HTTP ${resp.status} for ${url}`);
      return null;
    }

    return await resp.text();
  } catch (err: any) {
    console.error(`  Fetch error for ${url}: ${err.message}`);
    return null;
  }
}

async function main() {
  console.log('=== .gov Guide Crawling ===\n');

  for (const source of SOURCES) {
    console.log(`[${source.fileName}]`);
    const parts: string[] = [`# Source URLs\n`];

    for (const url of source.urls) {
      parts.push(`- ${url}`);
    }
    parts.push('\n---\n');

    let successCount = 0;

    for (const url of source.urls) {
      const html = await fetchPage(url);
      if (!html) {
        parts.push(`\n[FAILED] ${url}\n`);
        continue;
      }

      const text = extractText(html, url);
      if (text.length < 100) {
        console.log(`  Warning: Very short content from ${url} (${text.length} chars)`);
      }

      parts.push(`\n## Source: ${url}\n`);
      parts.push(text);
      parts.push('\n');
      successCount++;
    }

    const outPath = resolve(OUT_DIR, source.fileName);
    writeFileSync(outPath, parts.join('\n'), 'utf-8');
    console.log(`  → Saved: ${outPath} (${successCount}/${source.urls.length} URLs)\n`);
  }

  console.log('=== Done ===');
}

main().catch(console.error);
