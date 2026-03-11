/**
 * query-ga4-analytics.ts
 *
 * Google Analytics 4 Data API로 트래픽 데이터 조회
 *
 * 사전 요구사항:
 *   1. GA4 Admin에서 서비스 계정 이메일을 뷰어로 추가:
 *      haninmap-gsc@haninmap.iam.gserviceaccount.com
 *   2. Google Cloud Console에서 "Google Analytics Data API" 활성화
 *   3. .env에 GA4_PROPERTY_ID 설정 (없으면 자동 탐색 시도)
 *
 * Usage:
 *   npx tsx scripts/query-ga4-analytics.ts
 *   npx tsx scripts/query-ga4-analytics.ts --days=90
 *   npx tsx scripts/query-ga4-analytics.ts --property=123456789
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

// ─── Config ───────────────────────────────────────────────────────────

function getKeyPath(): string {
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
  return absKeyPath;
}

// ─── GA4 Property Discovery ──────────────────────────────────────────

async function findGA4PropertyId(keyPath: string): Promise<string | null> {
  try {
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
    });
    const authClient = await auth.getClient();
    const analyticsAdmin = google.analyticsadmin({
      version: 'v1beta',
      auth: authClient as any,
    });

    const accounts = await analyticsAdmin.accounts.list();
    const accountList = accounts.data.accounts || [];

    for (const account of accountList) {
      const props = await analyticsAdmin.properties.list({
        filter: `parent:${account.name}`,
      });
      const properties = props.data.properties || [];
      for (const prop of properties) {
        // Look for haninmap property
        if (
          prop.displayName?.toLowerCase().includes('haninmap') ||
          prop.displayName?.toLowerCase().includes('한인맵')
        ) {
          // property name format: "properties/123456789"
          return prop.name?.replace('properties/', '') || null;
        }
      }
    }
  } catch (err: any) {
    console.log(`  Auto-discovery failed: ${err.message}`);
  }
  return null;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const daysArg = args.find(a => a.startsWith('--days='));
  const propertyArg = args.find(a => a.startsWith('--property='));
  const days = daysArg ? parseInt(daysArg.split('=')[1], 10) : 28;

  const keyPath = getKeyPath();

  // Resolve property ID
  let propertyId = propertyArg?.split('=')[1] || process.env.GA4_PROPERTY_ID;
  if (!propertyId) {
    console.log('GA4_PROPERTY_ID not set. Attempting auto-discovery...');
    propertyId = await findGA4PropertyId(keyPath) || undefined;
    if (!propertyId) {
      console.error('\nCould not find GA4 property. Please set GA4_PROPERTY_ID in .env');
      console.error('Or pass --property=YOUR_PROPERTY_ID');
      console.error('\nTo find your property ID:');
      console.error('  1. Go to https://analytics.google.com');
      console.error('  2. Admin → Property Settings → Property ID');
      process.exit(1);
    }
    console.log(`  Found property: ${propertyId}`);
  }

  const client = new BetaAnalyticsDataClient({ keyFilename: keyPath });
  const property = `properties/${propertyId}`;

  console.log('\n📈 GA4 Analytics Report');
  console.log(`   Property: ${propertyId}`);
  console.log(`   Period: Last ${days} days\n`);

  // 1. Overview: Sessions, Users, Pageviews, Bounce Rate
  console.log('='.repeat(80));
  console.log('  Traffic Overview');
  console.log('='.repeat(80));
  try {
    const [overview] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'newUsers' },
        { name: 'screenPageViews' },
        { name: 'averageSessionDuration' },
        { name: 'bounceRate' },
        { name: 'engagedSessions' },
      ],
    });

    const row = overview.rows?.[0];
    if (row?.metricValues) {
      const [sessions, users, newUsers, pageviews, avgDuration, bounceRate, engaged] =
        row.metricValues.map(v => v.value || '0');
      console.log(`  Sessions:          ${parseInt(sessions).toLocaleString()}`);
      console.log(`  Total Users:       ${parseInt(users).toLocaleString()}`);
      console.log(`  New Users:         ${parseInt(newUsers).toLocaleString()}`);
      console.log(`  Pageviews:         ${parseInt(pageviews).toLocaleString()}`);
      console.log(`  Avg Duration:      ${parseFloat(avgDuration).toFixed(0)}s`);
      console.log(`  Bounce Rate:       ${(parseFloat(bounceRate) * 100).toFixed(1)}%`);
      console.log(`  Engaged Sessions:  ${parseInt(engaged).toLocaleString()}`);
      console.log(`  Daily Avg Users:   ${(parseInt(users) / days).toFixed(1)}`);
    }
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }

  // 2. Traffic Source
  console.log(`\n${'='.repeat(80)}`);
  console.log('  Traffic Sources (Session Source / Medium)');
  console.log('='.repeat(80));
  try {
    const [sources] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'sessionSourceMedium' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'bounceRate' },
      ],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 15,
    });

    console.log(
      `  ${'Source / Medium'.padEnd(40)} ${'Sessions'.padStart(10)} ${'Users'.padStart(8)} ${'Bounce'.padStart(8)}`
    );
    console.log(`  ${'-'.repeat(68)}`);
    overview_rows(sources);
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }

  // 3. Top Pages
  console.log(`\n${'='.repeat(80)}`);
  console.log('  Top Pages (by pageviews)');
  console.log('='.repeat(80));
  try {
    const [pages] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'pagePath' }],
      metrics: [
        { name: 'screenPageViews' },
        { name: 'totalUsers' },
        { name: 'averageSessionDuration' },
      ],
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 30,
    });

    console.log(
      `  ${'Page Path'.padEnd(50)} ${'Views'.padStart(8)} ${'Users'.padStart(8)} ${'AvgDur'.padStart(8)}`
    );
    console.log(`  ${'-'.repeat(76)}`);
    pages.rows?.forEach(row => {
      const path = row.dimensionValues?.[0]?.value || '';
      const views = row.metricValues?.[0]?.value || '0';
      const users = row.metricValues?.[1]?.value || '0';
      const dur = row.metricValues?.[2]?.value || '0';
      const displayPath = path.length > 49 ? path.slice(0, 46) + '...' : path;
      console.log(
        `  ${displayPath.padEnd(50)} ${parseInt(views).toLocaleString().padStart(8)} ${parseInt(users).toLocaleString().padStart(8)} ${parseFloat(dur).toFixed(0).padStart(7)}s`
      );
    });
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }

  // 4. Geography
  console.log(`\n${'='.repeat(80)}`);
  console.log('  Top Countries & Cities');
  console.log('='.repeat(80));
  try {
    const [geo] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'totalUsers' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      limit: 10,
    });

    console.log(`  ${'Country'.padEnd(30)} ${'Users'.padStart(8)} ${'Sessions'.padStart(10)}`);
    console.log(`  ${'-'.repeat(50)}`);
    geo.rows?.forEach(row => {
      const country = row.dimensionValues?.[0]?.value || '';
      const users = row.metricValues?.[0]?.value || '0';
      const sessions = row.metricValues?.[1]?.value || '0';
      console.log(
        `  ${country.padEnd(30)} ${parseInt(users).toLocaleString().padStart(8)} ${parseInt(sessions).toLocaleString().padStart(10)}`
      );
    });

    // Cities
    const [cities] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'city' }],
      metrics: [{ name: 'totalUsers' }, { name: 'sessions' }],
      orderBys: [{ metric: { metricName: 'totalUsers' }, desc: true }],
      limit: 15,
    });

    console.log(`\n  ${'City'.padEnd(30)} ${'Users'.padStart(8)} ${'Sessions'.padStart(10)}`);
    console.log(`  ${'-'.repeat(50)}`);
    cities.rows?.forEach(row => {
      const city = row.dimensionValues?.[0]?.value || '';
      const users = row.metricValues?.[0]?.value || '0';
      const sessions = row.metricValues?.[1]?.value || '0';
      console.log(
        `  ${city.padEnd(30)} ${parseInt(users).toLocaleString().padStart(8)} ${parseInt(sessions).toLocaleString().padStart(10)}`
      );
    });
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }

  // 5. Device
  console.log(`\n${'='.repeat(80)}`);
  console.log('  Device Category');
  console.log('='.repeat(80));
  try {
    const [devices] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'deviceCategory' }],
      metrics: [{ name: 'totalUsers' }, { name: 'sessions' }, { name: 'bounceRate' }],
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    });

    console.log(
      `  ${'Device'.padEnd(20)} ${'Users'.padStart(8)} ${'Sessions'.padStart(10)} ${'Bounce'.padStart(8)}`
    );
    console.log(`  ${'-'.repeat(48)}`);
    devices.rows?.forEach(row => {
      const device = row.dimensionValues?.[0]?.value || '';
      const users = row.metricValues?.[0]?.value || '0';
      const sessions = row.metricValues?.[1]?.value || '0';
      const bounce = row.metricValues?.[2]?.value || '0';
      console.log(
        `  ${device.padEnd(20)} ${parseInt(users).toLocaleString().padStart(8)} ${parseInt(sessions).toLocaleString().padStart(10)} ${(parseFloat(bounce) * 100).toFixed(1).padStart(7)}%`
      );
    });
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }

  // 6. Landing Pages (organic only)
  console.log(`\n${'='.repeat(80)}`);
  console.log('  Organic Search Landing Pages');
  console.log('='.repeat(80));
  try {
    const [organic] = await client.runReport({
      property,
      dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'yesterday' }],
      dimensions: [{ name: 'landingPage' }],
      metrics: [
        { name: 'sessions' },
        { name: 'totalUsers' },
        { name: 'bounceRate' },
        { name: 'averageSessionDuration' },
      ],
      dimensionFilter: {
        filter: {
          fieldName: 'sessionDefaultChannelGroup',
          stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
        },
      },
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 20,
    });

    console.log(
      `  ${'Landing Page'.padEnd(50)} ${'Sessions'.padStart(10)} ${'Users'.padStart(8)} ${'Bounce'.padStart(8)}`
    );
    console.log(`  ${'-'.repeat(78)}`);
    organic.rows?.forEach(row => {
      const page = row.dimensionValues?.[0]?.value || '';
      const sessions = row.metricValues?.[0]?.value || '0';
      const users = row.metricValues?.[1]?.value || '0';
      const bounce = row.metricValues?.[2]?.value || '0';
      const displayPage = page.length > 49 ? page.slice(0, 46) + '...' : page;
      console.log(
        `  ${displayPage.padEnd(50)} ${parseInt(sessions).toLocaleString().padStart(10)} ${parseInt(users).toLocaleString().padStart(8)} ${(parseFloat(bounce) * 100).toFixed(1).padStart(7)}%`
      );
    });
  } catch (err: any) {
    console.log(`  Error: ${err.message}`);
  }

  console.log('');
}

function overview_rows(report: any) {
  report.rows?.forEach((row: any) => {
    const source = row.dimensionValues?.[0]?.value || '';
    const sessions = row.metricValues?.[0]?.value || '0';
    const users = row.metricValues?.[1]?.value || '0';
    const bounce = row.metricValues?.[2]?.value || '0';
    const displaySource = source.length > 39 ? source.slice(0, 36) + '...' : source;
    console.log(
      `  ${displaySource.padEnd(40)} ${parseInt(sessions).toLocaleString().padStart(10)} ${parseInt(users).toLocaleString().padStart(8)} ${(parseFloat(bounce) * 100).toFixed(1).padStart(7)}%`
    );
  });
}

main().catch(console.error);
