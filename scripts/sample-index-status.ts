/**
 * sample-index-status.ts
 *
 * DB에서 자동으로 URL 샘플을 생성하여 인덱싱 상태를 확인합니다.
 *
 * Usage:
 *   npx tsx scripts/sample-index-status.ts
 *   npx tsx scripts/sample-index-status.ts --limit=20
 */

import { google } from 'googleapis';
import { writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DELAY_MS = 1200;
const BASE_URL = 'https://www.haninmap.com';

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function getAuthClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyPath) {
    console.error('Error: GOOGLE_SERVICE_ACCOUNT_JSON env var not set.');
    process.exit(1);
  }
  const absKeyPath = resolve(keyPath);
  if (!existsSync(absKeyPath)) {
    console.error(`Service account key file not found: ${absKeyPath}`);
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: absKeyPath,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return auth.getClient();
}

async function generateSampleUrls(): Promise<{ url: string; type: string }[]> {
  const urls: { url: string; type: string }[] = [];

  // L1: Top primary category pages (10)
  const l1Pages = await prisma.business.groupBy({
    by: ['city', 'state', 'primaryCategoryId'],
    _count: { _all: true },
    where: { countryCode: 'US' },
    orderBy: { _count: { city: 'desc' } },
    take: 10,
  });

  const catIds = [...new Set(l1Pages.map(p => p.primaryCategoryId))];
  const categories = await prisma.category.findMany({
    where: { id: { in: catIds } },
    select: { id: true, slug: true },
  });
  const catMap = new Map(categories.map(c => [c.id, c.slug]));

  for (const p of l1Pages) {
    const catSlug = catMap.get(p.primaryCategoryId);
    if (!catSlug || !p.city || !p.state) continue;
    const citySlug = p.city.toLowerCase().replace(/\s+/g, '-');
    const stateSlug = p.state.toLowerCase();
    urls.push({
      url: `${BASE_URL}/${stateSlug}/${citySlug}/${catSlug}`,
      type: 'L1',
    });
  }

  // L2: Subcategory pages (10)
  const l2Pages = await prisma.business.groupBy({
    by: ['city', 'state', 'subcategoryId'],
    _count: { _all: true },
    where: { countryCode: 'US', subcategoryId: { not: null } },
    orderBy: { _count: { city: 'desc' } },
    take: 10,
  });

  const subCatIds = l2Pages.map(p => p.subcategoryId).filter((id): id is number => id !== null);
  const subCategories = await prisma.category.findMany({
    where: { id: { in: subCatIds } },
    select: { id: true, slug: true },
  });
  const subCatMap = new Map(subCategories.map(c => [c.id, c.slug]));

  for (const p of l2Pages) {
    if (!p.subcategoryId) continue;
    const catSlug = subCatMap.get(p.subcategoryId);
    if (!catSlug || !p.city || !p.state) continue;
    const citySlug = p.city.toLowerCase().replace(/\s+/g, '-');
    const stateSlug = p.state.toLowerCase();
    urls.push({
      url: `${BASE_URL}/${stateSlug}/${citySlug}/${catSlug}`,
      type: 'L2',
    });
  }

  // L3: Business detail pages (20) - mix of high and low quality
  const highQualityBiz = await prisma.business.findMany({
    where: {
      slug: { not: null },
      googlePlace: { rating: { gte: 4.2 }, userRatingsTotal: { gte: 10 } },
    },
    select: { slug: true },
    orderBy: { qualityScore: 'desc' },
    take: 10,
  });

  const lowQualityBiz = await prisma.business.findMany({
    where: {
      slug: { not: null },
      googlePlace: {
        OR: [
          { rating: { lt: 4.0 } },
          { userRatingsTotal: { lt: 5 } },
        ],
      },
    },
    select: { slug: true },
    take: 10,
  });

  for (const b of highQualityBiz) {
    if (b.slug) urls.push({ url: `${BASE_URL}/biz/${b.slug}`, type: 'L3-high' });
  }
  for (const b of lowQualityBiz) {
    if (b.slug) urls.push({ url: `${BASE_URL}/biz/${b.slug}`, type: 'L3-low' });
  }

  // City hub pages (10)
  const cityHubs = await prisma.business.groupBy({
    by: ['city', 'state'],
    _count: { _all: true },
    where: { countryCode: 'US' },
    orderBy: { _count: { city: 'desc' } },
    take: 10,
  });

  for (const c of cityHubs) {
    if (!c.city || !c.state) continue;
    const citySlug = c.city.toLowerCase().replace(/\s+/g, '-');
    const stateSlug = c.state.toLowerCase();
    urls.push({ url: `${BASE_URL}/${stateSlug}/${citySlug}`, type: 'city-hub' });
  }

  return urls;
}

interface StatusRow {
  url: string;
  type: string;
  verdict: string;
  coverageState: string;
  robotsTxtState: string;
  indexingState: string;
  lastCrawlTime: string;
  pageFetchState: string;
  error: string;
}

async function main() {
  const args = process.argv.slice(2);
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 50;

  const siteUrl = process.env.GSC_SITE_URL || 'sc-domain:haninmap.com';

  console.log('=== Sample Index Status Check ===');
  console.log(`  Site URL:   ${siteUrl}`);
  console.log('  Generating sample URLs from database...\n');

  const allUrls = await generateSampleUrls();
  const urlsToCheck = allUrls.slice(0, limit);

  const typeCounts: Record<string, number> = {};
  urlsToCheck.forEach(u => { typeCounts[u.type] = (typeCounts[u.type] || 0) + 1; });
  console.log('  URL breakdown:');
  Object.entries(typeCounts).forEach(([type, count]) => {
    console.log(`    ${type}: ${count}`);
  });
  console.log(`  Total: ${urlsToCheck.length}\n`);

  const authClient = await getAuthClient();
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient as any });

  const rows: StatusRow[] = [];
  let indexed = 0;
  let notIndexed = 0;
  let errored = 0;

  for (let i = 0; i < urlsToCheck.length; i++) {
    const { url, type } = urlsToCheck[i];
    const progress = `[${i + 1}/${urlsToCheck.length}]`;

    try {
      const response = await searchconsole.urlInspection.index.inspect({
        requestBody: { inspectionUrl: url, siteUrl },
      });

      const result = response.data.inspectionResult;
      const indexStatus = result?.indexStatusResult;

      const verdict = indexStatus?.verdict || 'UNKNOWN';
      const coverageState = indexStatus?.coverageState || '';
      const robotsTxtState = indexStatus?.robotsTxtState || '';
      const indexingState = indexStatus?.indexingState || '';
      const lastCrawlTime = indexStatus?.lastCrawlTime || '';
      const pageFetchState = indexStatus?.pageFetchState || '';

      const isIndexed = verdict === 'PASS';
      if (isIndexed) indexed++;
      else notIndexed++;

      const status = isIndexed ? 'INDEXED' : 'NOT_INDEXED';
      console.log(`${progress} ${status.padEnd(12)} [${type.padEnd(8)}] ${url} (${coverageState})`);

      rows.push({ url, type, verdict, coverageState, robotsTxtState, indexingState, lastCrawlTime, pageFetchState, error: '' });
    } catch (err: any) {
      const msg = err.message || String(err);
      console.error(`${progress} ERROR        [${type.padEnd(8)}] ${url} - ${msg}`);
      errored++;
      rows.push({ url, type, verdict: 'ERROR', coverageState: '', robotsTxtState: '', indexingState: '', lastCrawlTime: '', pageFetchState: '', error: msg.slice(0, 200) });

      if (msg.includes('quota') || msg.includes('rateLimitExceeded')) {
        console.error('\nQuota exceeded. Stopping.');
        break;
      }
    }

    if (i < urlsToCheck.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  // Write CSV
  const outputFile = `sample-index-status-${new Date().toISOString().split('T')[0]}.csv`;
  const header = 'url,type,verdict,coverageState,robotsTxtState,indexingState,lastCrawlTime,pageFetchState,error';
  const csvRows = rows.map(r =>
    [r.url, r.type, r.verdict, r.coverageState, r.robotsTxtState, r.indexingState, r.lastCrawlTime, r.pageFetchState, `"${r.error}"`].join(',')
  );
  writeFileSync(resolve(outputFile), [header, ...csvRows].join('\n') + '\n');

  // Summary
  console.log('\n=== Summary ===');
  console.log(`  Total:       ${rows.length}`);
  console.log(`  Indexed:     ${indexed}`);
  console.log(`  Not indexed: ${notIndexed}`);
  console.log(`  Errors:      ${errored}`);
  console.log(`  Index rate:  ${rows.length > 0 ? ((indexed / rows.length) * 100).toFixed(1) : 0}%`);

  // Per-type breakdown
  const typeResults: Record<string, { indexed: number; total: number }> = {};
  rows.forEach(r => {
    if (!typeResults[r.type]) typeResults[r.type] = { indexed: 0, total: 0 };
    typeResults[r.type].total++;
    if (r.verdict === 'PASS') typeResults[r.type].indexed++;
  });

  console.log('\n  By type:');
  Object.entries(typeResults).forEach(([type, data]) => {
    const rate = data.total > 0 ? ((data.indexed / data.total) * 100).toFixed(0) : '0';
    console.log(`    ${type.padEnd(10)} ${data.indexed}/${data.total} indexed (${rate}%)`);
  });

  console.log(`\n  CSV output: ${outputFile}`);

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
