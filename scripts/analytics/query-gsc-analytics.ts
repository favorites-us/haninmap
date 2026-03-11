/**
 * query-gsc-analytics.ts
 *
 * GSC Search Analytics API로 검색 성과 데이터 조회
 * (클릭, 노출, CTR, 평균 게재순위)
 *
 * Usage:
 *   npx tsx scripts/query-gsc-analytics.ts
 *   npx tsx scripts/query-gsc-analytics.ts --days=90
 *   npx tsx scripts/query-gsc-analytics.ts --type=query
 *   npx tsx scripts/query-gsc-analytics.ts --type=page
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ───────────────────────────────────────────────────────────

const SITE_URL = process.env.GSC_SITE_URL || 'sc-domain:haninmap.com';

// ─── Auth ─────────────────────────────────────────────────────────────

async function getAuthClient() {
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!keyPath) {
    console.error('Error: GOOGLE_SERVICE_ACCOUNT_JSON env var not set.');
    process.exit(1);
  }
  const absKeyPath = path.resolve(keyPath);
  if (!fs.existsSync(absKeyPath)) {
    console.error(`Service account key not found: ${absKeyPath}`);
    process.exit(1);
  }
  const auth = new google.auth.GoogleAuth({
    keyFile: absKeyPath,
    scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
  });
  return auth.getClient();
}

// ─── Helpers ──────────────────────────────────────────────────────────

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function getDateRange(days: number) {
  const end = new Date();
  end.setDate(end.getDate() - 1); // yesterday (GSC data has ~2 day lag)
  const start = new Date();
  start.setDate(start.getDate() - days);
  return { startDate: formatDate(start), endDate: formatDate(end) };
}

// ─── Queries ──────────────────────────────────────────────────────────

interface SearchRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

async function querySearchAnalytics(
  webmasters: ReturnType<typeof google.searchconsole>,
  dimensions: string[],
  days: number,
  rowLimit = 50
): Promise<SearchRow[]> {
  const { startDate, endDate } = getDateRange(days);

  const response = await webmasters.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate,
      endDate,
      dimensions,
      rowLimit,
      dataState: 'final',
    },
  });

  return (response.data.rows || []) as SearchRow[];
}

async function querySiteOverview(
  webmasters: ReturnType<typeof google.searchconsole>,
  days: number
) {
  const { startDate, endDate } = getDateRange(days);

  const response = await webmasters.searchanalytics.query({
    siteUrl: SITE_URL,
    requestBody: {
      startDate,
      endDate,
      dimensions: ['date'],
      rowLimit: 1000,
      dataState: 'final',
    },
  });

  const rows = (response.data.rows || []) as SearchRow[];
  const totals = rows.reduce(
    (acc, r) => ({
      clicks: acc.clicks + r.clicks,
      impressions: acc.impressions + r.impressions,
    }),
    { clicks: 0, impressions: 0 }
  );

  return {
    startDate,
    endDate,
    totalClicks: totals.clicks,
    totalImpressions: totals.impressions,
    avgCtr: totals.impressions > 0 ? totals.clicks / totals.impressions : 0,
    dailyAvgClicks: rows.length > 0 ? totals.clicks / rows.length : 0,
    dailyAvgImpressions: rows.length > 0 ? totals.impressions / rows.length : 0,
    days: rows.length,
  };
}

// ─── Display ──────────────────────────────────────────────────────────

function printTable(title: string, rows: SearchRow[], keyLabel: string) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`  ${title}`);
  console.log(`${'='.repeat(80)}`);
  console.log(
    `  ${'#'.padEnd(4)} ${keyLabel.padEnd(45)} ${'Clicks'.padStart(7)} ${'Impr'.padStart(8)} ${'CTR'.padStart(7)} ${'Pos'.padStart(6)}`
  );
  console.log(`  ${'-'.repeat(78)}`);

  rows.forEach((row, i) => {
    const key = row.keys[0].length > 44 ? row.keys[0].slice(0, 41) + '...' : row.keys[0];
    console.log(
      `  ${String(i + 1).padEnd(4)} ${key.padEnd(45)} ${String(row.clicks).padStart(7)} ${String(row.impressions).padStart(8)} ${(row.ctr * 100).toFixed(1).padStart(6)}% ${row.position.toFixed(1).padStart(6)}`
    );
  });
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const typeArg = args.find(a => a.startsWith('--type='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 28;
  const type = typeArg ? typeArg.split('=')[1] : 'all';

  const authClient = await getAuthClient();
  const webmasters = google.searchconsole({ version: 'v1', auth: authClient as any });

  // 1. Site Overview
  console.log('\n🔍 GSC Search Analytics Report');
  console.log(`   Site: ${SITE_URL}`);

  const overview = await querySiteOverview(webmasters, days);
  console.log(`\n📊 Overview (${overview.startDate} ~ ${overview.endDate}, ${overview.days} days)`);
  console.log(`   Total Clicks:      ${overview.totalClicks.toLocaleString()}`);
  console.log(`   Total Impressions: ${overview.totalImpressions.toLocaleString()}`);
  console.log(`   Avg CTR:           ${(overview.avgCtr * 100).toFixed(2)}%`);
  console.log(`   Daily Avg Clicks:  ${overview.dailyAvgClicks.toFixed(1)}`);
  console.log(`   Daily Avg Impr:    ${overview.dailyAvgImpressions.toFixed(1)}`);

  if (type === 'all' || type === 'query') {
    // 2. Top Queries
    const queries = await querySearchAnalytics(webmasters, ['query'], days, 30);
    printTable('Top Search Queries (by clicks)', queries, 'Query');

    // 3. Top Queries by Impressions (potential keywords)
    const queriesByImpressions = await querySearchAnalytics(webmasters, ['query'], days, 30);
    // Sort by impressions desc (API returns by clicks)
    // Re-query with different sorting isn't directly supported, so we show high-impression queries
  }

  if (type === 'all' || type === 'page') {
    // 4. Top Pages
    const pages = await querySearchAnalytics(webmasters, ['page'], days, 30);
    printTable('Top Pages (by clicks)', pages, 'Page URL');
  }

  if (type === 'all') {
    // 5. Top Countries
    const countries = await querySearchAnalytics(webmasters, ['country'], days, 10);
    printTable('Top Countries', countries, 'Country');

    // 6. Device breakdown
    const devices = await querySearchAnalytics(webmasters, ['device'], days, 5);
    printTable('Device Breakdown', devices, 'Device');

    // 7. Search Appearance
    try {
      const appearance = await querySearchAnalytics(webmasters, ['searchAppearance'], days, 10);
      if (appearance.length > 0) {
        printTable('Search Appearance', appearance, 'Type');
      }
    } catch {
      // searchAppearance may not be available
    }
  }

  // 8. Indexing status summary
  console.log(`\n${'='.repeat(80)}`);
  console.log('  Indexing Status');
  console.log(`${'='.repeat(80)}`);
  try {
    const sitemaps = await webmasters.sitemaps.list({ siteUrl: SITE_URL });
    const sitemapList = sitemaps.data.sitemap || [];
    sitemapList.forEach(sm => {
      const submitted = sm.contents?.reduce((sum, c) => sum + (c.submitted ? parseInt(String(c.submitted)) : 0), 0) || 0;
      const indexed = sm.contents?.reduce((sum, c) => sum + (c.indexed ? parseInt(String(c.indexed)) : 0), 0) || 0;
      console.log(`  ${sm.path}`);
      console.log(`    Submitted: ${submitted}, Indexed: ${indexed}`);
    });
  } catch (err: any) {
    console.log(`  Could not fetch sitemap data: ${err.message}`);
  }

  console.log('');
}

main().catch(console.error);
