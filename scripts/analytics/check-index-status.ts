/**
 * check-index-status.ts
 *
 * Google Search Console URL Inspection API로 인덱싱 상태 확인
 * 결과를 CSV 파일로 출력
 *
 * 사전 요구사항:
 *   1. Google Cloud Console에서 Search Console API 활성화
 *   2. Service Account 생성 및 JSON 키 다운로드
 *   3. GSC에서 해당 Service Account 이메일을 소유자로 추가
 *   4. .env에 설정:
 *      GOOGLE_SERVICE_ACCOUNT_JSON=./path/to/service-account.json
 *      GSC_SITE_URL=https://www.haninmap.com  (또는 sc-domain:haninmap.com)
 *
 * Usage:
 *   npx tsx scripts/check-index-status.ts urls-l1.txt
 *   npx tsx scripts/check-index-status.ts urls-l1.txt --limit=50
 *   npx tsx scripts/check-index-status.ts urls-l1.txt --output=status-l1.csv
 */

import { google } from 'googleapis';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, basename } from 'path';

// ─── Config ───────────────────────────────────────────────────────────

const DELAY_MS = 1200; // URL Inspection API has stricter rate limits
const DEFAULT_LIMIT = 100;

// ─── Helpers ──────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function loadUrlsFromFile(filePath: string): string[] {
  const absPath = resolve(filePath);
  if (!existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
  }
  return readFileSync(absPath, 'utf-8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 0 && l.startsWith('http'));
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

// ─── Main ─────────────────────────────────────────────────────────────

interface StatusRow {
  url: string;
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
  const fileArg = args.find(a => !a.startsWith('--'));
  const limitArg = args.find(a => a.startsWith('--limit='));
  const outputArg = args.find(a => a.startsWith('--output='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : DEFAULT_LIMIT;

  if (!fileArg) {
    console.error('Usage: npx tsx scripts/check-index-status.ts <url-file> [--limit=N] [--output=file.csv]');
    process.exit(1);
  }

  const siteUrl = process.env.GSC_SITE_URL;
  if (!siteUrl) {
    console.error('Error: GSC_SITE_URL env var not set.');
    console.error('Set it to your GSC property URL, e.g.:');
    console.error('  GSC_SITE_URL=https://www.haninmap.com');
    console.error('  GSC_SITE_URL=sc-domain:haninmap.com');
    process.exit(1);
  }

  const urls = loadUrlsFromFile(fileArg);
  const urlsToCheck = urls.slice(0, limit);
  const outputFile = outputArg
    ? outputArg.split('=')[1]
    : `status-${basename(fileArg, '.txt')}.csv`;

  console.log(`=== GSC Index Status Check ===`);
  console.log(`  File:       ${fileArg}`);
  console.log(`  Site URL:   ${siteUrl}`);
  console.log(`  Total URLs: ${urls.length}`);
  console.log(`  Checking:   ${urlsToCheck.length} (limit: ${limit})`);
  console.log(`  Output:     ${outputFile}`);
  console.log('');

  const authClient = await getAuthClient();
  const searchconsole = google.searchconsole({ version: 'v1', auth: authClient as any });

  const rows: StatusRow[] = [];
  let indexed = 0;
  let notIndexed = 0;
  let errored = 0;

  for (let i = 0; i < urlsToCheck.length; i++) {
    const url = urlsToCheck[i];
    const progress = `[${i + 1}/${urlsToCheck.length}]`;

    try {
      const response = await searchconsole.urlInspection.index.inspect({
        requestBody: {
          inspectionUrl: url,
          siteUrl,
        },
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
      console.log(`${progress} ${status.padEnd(12)} ${url} (${coverageState})`);

      rows.push({
        url,
        verdict,
        coverageState,
        robotsTxtState,
        indexingState,
        lastCrawlTime,
        pageFetchState,
        error: '',
      });
    } catch (err: any) {
      const msg = err.message || String(err);
      console.error(`${progress} ERROR        ${url} - ${msg}`);
      errored++;

      rows.push({
        url,
        verdict: 'ERROR',
        coverageState: '',
        robotsTxtState: '',
        indexingState: '',
        lastCrawlTime: '',
        pageFetchState: '',
        error: msg.slice(0, 200),
      });

      // Stop on quota exceeded
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
  const header = 'url,verdict,coverageState,robotsTxtState,indexingState,lastCrawlTime,pageFetchState,error';
  const csvRows = rows.map(r =>
    [r.url, r.verdict, r.coverageState, r.robotsTxtState, r.indexingState, r.lastCrawlTime, r.pageFetchState, `"${r.error}"`].join(',')
  );
  const csv = [header, ...csvRows].join('\n') + '\n';
  writeFileSync(resolve(outputFile), csv);

  console.log('\n=== Summary ===');
  console.log(`  Indexed:     ${indexed}`);
  console.log(`  Not indexed: ${notIndexed}`);
  console.log(`  Errors:      ${errored}`);
  console.log(`  CSV output:  ${outputFile}`);

  if (urls.length > urlsToCheck.length) {
    console.log(`  Remaining:   ${urls.length - urlsToCheck.length} (use --limit=${urls.length} to check all)`);
  }
}

main().catch(console.error);
