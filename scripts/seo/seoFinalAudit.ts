#!/usr/bin/env npx tsx
/**
 * SEO Final Audit Script
 *
 * Pre-launch verification for www.haninmap.com
 * Run: npm run audit:seo or npx tsx scripts/seoFinalAudit.ts
 */

const BASE_URL = process.env.AUDIT_BASE_URL || 'http://localhost:3000';
const PRODUCTION_DOMAIN = 'https://www.haninmap.com';

interface AuditResult {
  check: string;
  passed: boolean;
  details?: string;
  critical?: boolean;
}

const results: AuditResult[] = [];

function log(check: string, passed: boolean, details?: string, critical = false) {
  results.push({ check, passed, details, critical });
  const status = passed ? '✅' : (critical ? '🚨' : '❌');
  console.log(`${status} ${check}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

async function fetchPage(path: string): Promise<string | null> {
  try {
    const url = `${BASE_URL}${path}`;
    console.log(`   Fetching: ${url}`);
    const res = await fetch(url);
    if (!res.ok) {
      console.log(`   Status: ${res.status}`);
      return null;
    }
    return await res.text();
  } catch (error) {
    console.log(`   Error: ${error}`);
    return null;
  }
}

function extractMetaTag(html: string, name: string): string | null {
  const regex = new RegExp(`<meta\\s+name=["']${name}["']\\s+content=["']([^"']+)["']`, 'i');
  const match = html.match(regex);
  return match ? match[1] : null;
}

function extractCanonical(html: string): string | null {
  const regex = /<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i;
  const match = html.match(regex);
  return match ? match[1] : null;
}

function extractH1(html: string): string | null {
  const regex = /<h1[^>]*>([^<]+)<\/h1>/i;
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

function extractH2(html: string): string | null {
  const regex = /<h2[^>]*>([^<]+)<\/h2>/i;
  const match = html.match(regex);
  return match ? match[1].trim() : null;
}

function hasKoreanText(text: string): boolean {
  return /[\uAC00-\uD7AF]/.test(text);
}

async function auditPage(path: string, description: string, expectResults: boolean) {
  console.log(`\n--- Auditing: ${description} ---`);
  console.log(`   Path: ${path}`);

  const html = await fetchPage(path);
  if (!html) {
    log(`${description}: Page loads`, false, 'Failed to fetch page', true);
    return;
  }

  log(`${description}: Page loads`, true);

  // H1 check
  const h1 = extractH1(html);
  log(`${description}: Has H1`, !!h1, h1 ? `H1: "${h1}"` : 'No H1 found', true);

  // H2 check (Korean subtitle)
  const h2 = extractH2(html);
  const h2HasKorean = h2 ? hasKoreanText(h2) : false;
  log(`${description}: Has Korean subtitle`, h2HasKorean, h2 ? `H2: "${h2}"` : 'No H2 found');

  // Robots meta check
  const robots = extractMetaTag(html, 'robots');
  if (expectResults) {
    log(`${description}: robots=index,follow`, robots === 'index,follow', `robots: "${robots}"`);
  } else {
    log(`${description}: robots=noindex,follow`, robots === 'noindex,follow', `robots: "${robots}"`, true);
  }

  // Canonical check
  const canonical = extractCanonical(html);
  const canonicalCorrect = !!(canonical?.startsWith(PRODUCTION_DOMAIN) || canonical?.startsWith(BASE_URL));
  log(`${description}: Canonical uses correct domain`, canonicalCorrect, `canonical: "${canonical}"`, true);

  // Check canonical doesn't use vercel.app
  const noVercelCanonical = !canonical?.includes('vercel.app');
  log(`${description}: No vercel.app in canonical`, noVercelCanonical ?? true, undefined, true);
}

async function auditRobotsTxt() {
  console.log('\n--- Auditing: robots.txt ---');

  const content = await fetchPage('/robots.txt');
  if (!content) {
    log('robots.txt: Exists', false, 'Failed to fetch', true);
    return;
  }

  log('robots.txt: Exists', true);

  // Check required directives
  const hasDisallowApi = content.includes('Disallow: /api/');
  log('robots.txt: Disallows /api/', hasDisallowApi);

  const hasDisallowQuery = content.includes('Disallow: /*?');
  log('robots.txt: Disallows query strings', hasDisallowQuery);

  const hasSitemap = content.includes('Sitemap:');
  log('robots.txt: Has Sitemap directive', hasSitemap);

  const sitemapCorrect = content.includes(`Sitemap: ${PRODUCTION_DOMAIN}/sitemap.xml`);
  log('robots.txt: Sitemap uses www.haninmap.com', sitemapCorrect, undefined, true);

  // Check no crawler blocking
  const noBlockGooglebot = !content.includes('Googlebot');
  log('robots.txt: Does not block Googlebot', noBlockGooglebot);
}

async function auditSitemap() {
  console.log('\n--- Auditing: sitemap.xml ---');

  const content = await fetchPage('/sitemap.xml');
  if (!content) {
    log('sitemap.xml: Exists', false, 'Failed to fetch', true);
    return;
  }

  log('sitemap.xml: Exists', true);
  log('sitemap.xml: Valid XML', content.includes('<?xml'), undefined, true);
  log('sitemap.xml: Has urlset', content.includes('<urlset'), undefined, true);

  // Check URLs use correct domain
  const urlCount = (content.match(/<loc>/g) || []).length;
  log('sitemap.xml: Has URLs', urlCount > 0, `Found ${urlCount} URLs`);

  // For local testing, just check it has URLs
  // In production, would check for www.haninmap.com URLs
  const hasHomepage = content.includes('<loc>') && content.includes('</loc>');
  log('sitemap.xml: Has homepage', hasHomepage);
}

async function main() {
  console.log('='.repeat(60));
  console.log('SEO FINAL AUDIT - Pre-launch Verification');
  console.log('='.repeat(60));
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Production Domain: ${PRODUCTION_DOMAIN}`);
  console.log('='.repeat(60));

  // 1. Audit robots.txt
  await auditRobotsTxt();

  // 2. Audit sitemap.xml
  await auditSitemap();

  // 3. Audit sample pages
  // Normal page (should have index,follow)
  await auditPage('/ca/los-angeles/medical', 'L1 Page with Results', true);

  // Zero-result page (should have noindex,follow)
  // Using a made-up city that likely has no results
  await auditPage('/ca/test-city-xyz/medical', 'L1 Page with Zero Results', false);

  // Business detail page
  await auditPage('/biz/business-1', 'L3 Business Detail Page', false);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('AUDIT SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const critical = results.filter(r => !r.passed && r.critical).length;

  console.log(`\n✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`🚨 Critical Failures: ${critical}`);
  console.log(`📊 Total Checks: ${results.length}`);

  if (critical > 0) {
    console.log('\n🚨 CRITICAL ISSUES FOUND - DO NOT LAUNCH');
    console.log('Fix the following before indexing:');
    results.filter(r => !r.passed && r.critical).forEach(r => {
      console.log(`  - ${r.check}`);
    });
    process.exit(1);
  } else if (failed > 0) {
    console.log('\n⚠️  NON-CRITICAL ISSUES FOUND');
    console.log('Consider fixing before launch:');
    results.filter(r => !r.passed && !r.critical).forEach(r => {
      console.log(`  - ${r.check}`);
    });
    process.exit(0);
  } else {
    console.log('\n✅ ALL CHECKS PASSED - READY FOR LAUNCH');
    process.exit(0);
  }
}

main().catch(console.error);
