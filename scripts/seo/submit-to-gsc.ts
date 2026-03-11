/**
 * submit-to-gsc.ts
 *
 * Google Search Console Indexing API를 통해 URL 인덱싱 요청 제출
 *
 * 사전 요구사항:
 *   1. Google Cloud Console에서 Indexing API 활성화
 *   2. Service Account 생성 및 JSON 키 다운로드
 *   3. GSC에서 해당 Service Account 이메일을 소유자로 추가
 *   4. .env에 설정:
 *      GOOGLE_SERVICE_ACCOUNT_JSON=./path/to/service-account.json
 *
 * Usage:
 *   npx tsx scripts/submit-to-gsc.ts urls-l1.txt
 *   npx tsx scripts/submit-to-gsc.ts urls-l1.txt --dry-run
 *   npx tsx scripts/submit-to-gsc.ts urls-l1.txt --limit=100
 */

import { google } from 'googleapis';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

// ─── Config ───────────────────────────────────────────────────────────

const DAILY_QUOTA = 200; // Google Indexing API default quota per day
const DELAY_MS = 1000;   // 1 second between requests to avoid rate limits

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
    console.error('Set it to the path of your service account JSON key file.');
    process.exit(1);
  }

  const absKeyPath = resolve(keyPath);
  if (!existsSync(absKeyPath)) {
    console.error(`Service account key file not found: ${absKeyPath}`);
    process.exit(1);
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: absKeyPath,
    scopes: ['https://www.googleapis.com/auth/indexing'],
  });

  return auth.getClient();
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const fileArg = args.find(a => !a.startsWith('--'));
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find(a => a.startsWith('--limit='));
  const limit = limitArg ? parseInt(limitArg.split('=')[1], 10) : DAILY_QUOTA;

  if (!fileArg) {
    console.error('Usage: npx tsx scripts/submit-to-gsc.ts <url-file> [--dry-run] [--limit=N]');
    console.error('Example: npx tsx scripts/submit-to-gsc.ts urls-l1.txt --limit=100');
    process.exit(1);
  }

  const urls = loadUrlsFromFile(fileArg);
  const urlsToSubmit = urls.slice(0, limit);

  console.log(`=== GSC URL Submission ===`);
  console.log(`  File:      ${fileArg}`);
  console.log(`  Total URLs: ${urls.length}`);
  console.log(`  Submitting: ${urlsToSubmit.length} (limit: ${limit})`);
  console.log(`  Dry run:   ${dryRun}`);
  console.log('');

  if (dryRun) {
    console.log('Dry run mode - URLs that would be submitted:');
    urlsToSubmit.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
    console.log(`\nTotal: ${urlsToSubmit.length} URLs`);
    return;
  }

  const authClient = await getAuthClient();
  const indexing = google.indexing({ version: 'v3', auth: authClient as any });

  let success = 0;
  let failed = 0;
  let consecutiveErrors = 0;
  const MAX_CONSECUTIVE_ERRORS = 5;
  const errors: Array<{ url: string; error: string }> = [];

  for (let i = 0; i < urlsToSubmit.length; i++) {
    const url = urlsToSubmit[i];
    const progress = `[${i + 1}/${urlsToSubmit.length}]`;

    try {
      const response = await indexing.urlNotifications.publish({
        requestBody: {
          url,
          type: 'URL_UPDATED',
        },
      });

      console.log(`${progress} OK  ${url} (${response.status})`);
      success++;
      consecutiveErrors = 0;
    } catch (err: any) {
      const msg = err.message || String(err);
      console.error(`${progress} ERR ${url} - ${msg}`);
      errors.push({ url, error: msg });
      failed++;
      consecutiveErrors++;

      // Stop on quota exceeded or API disabled
      if (msg.includes('quota') || msg.includes('rateLimitExceeded')) {
        console.error('\nQuota exceeded. Stopping.');
        break;
      }
      if (msg.includes('has not been used in project') || msg.includes('is disabled')) {
        console.error('\nAPI not enabled. Enable it in Google Cloud Console and retry.');
        break;
      }
      // Stop after too many consecutive errors
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        console.error(`\n${MAX_CONSECUTIVE_ERRORS} consecutive errors. Stopping.`);
        break;
      }
    }

    // Rate limit delay
    if (i < urlsToSubmit.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  console.log('\n=== Results ===');
  console.log(`  Success: ${success}`);
  console.log(`  Failed:  ${failed}`);
  console.log(`  Remaining (not submitted): ${urls.length - urlsToSubmit.length}`);

  if (errors.length > 0) {
    console.log('\nErrors:');
    errors.forEach(e => console.log(`  ${e.url}: ${e.error}`));
  }
}

main().catch(console.error);
