/**
 * generate-url-list.ts
 *
 * Prisma로 DB에서 인덱싱 대상 URL을 추출하여
 * urls-l1.txt, urls-l2.txt, urls-l3.txt 파일로 출력
 *
 * Usage: npx tsx scripts/generate-url-list.ts
 */

import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();
const BASE_URL = 'https://www.haninmap.com';
const MIN_BUSINESS_COUNT = 3;
const OUTPUT_DIR = join(__dirname, '..');

// ─── Slug utilities (mirrored from src/lib/seo/slug-utils.ts) ────────

const STREET_TYPE_PREFIXES = [
  'st', 'rd', 'blvd', 'ave', 'dr', 'ct', 'ln', 'pl',
  'cir', 'hwy', 'pkwy', 'real', 'way', 'ter',
];
const STREET_PREFIX_RE = new RegExp(`^(${STREET_TYPE_PREFIXES.join('|')})-`, 'i');

function isMalformedCity(city: string | null | undefined): boolean {
  if (!city) return true;
  const slug = city.toLowerCase().trim().replace(/\s+/g, '-');
  if (STREET_PREFIX_RE.test(slug)) return true;
  if (['unknown', 'undefined', 'null'].includes(slug)) return true;
  if (slug.length < 2) return true;
  return false;
}

function normalizeCitySlug(city: string): string | null {
  let n = city.toLowerCase().trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!n || ['undefined', 'null', 'unknown'].includes(n)) return null;
  if (STREET_PREFIX_RE.test(n)) n = n.replace(STREET_PREFIX_RE, '').replace(/^-/, '');
  if (n.length < 2) return null;
  return n;
}

function normalizeSlug(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = v.toLowerCase().trim().replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  if (!n || ['undefined', 'null'].includes(n)) return null;
  return n;
}

function buildValidUrl(state: string, city: string, category: string): string | null {
  const s = normalizeSlug(state);
  const ci = normalizeCitySlug(city);
  const ca = normalizeSlug(category);
  if (!s || !ci || !ca) return null;
  const path = `${s}/${ci}/${ca}`;
  if (path.includes('//')) return null;
  return `${BASE_URL}/${path}`;
}

// ─── Main ─────────────────────────────────────────────────────────────

async function main() {
  console.log('=== URL List Generator ===\n');

  // Load category map
  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, level: true },
  });
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  const addedUrls = new Set<string>();

  // ── L1: Primary category pages ──────────────────────────────────────
  console.log('Generating L1 (primary category) URLs...');
  const l1Urls: string[] = [];

  const primaryCounts = await prisma.business.groupBy({
    by: ['city', 'state', 'primaryCategoryId'],
    _count: { _all: true },
    where: { countryCode: 'US' },
  });

  for (const item of primaryCounts) {
    if (!item._count._all || !item.city || !item.state || !item.primaryCategoryId) continue;
    if (item._count._all < MIN_BUSINESS_COUNT) continue;
    if (isMalformedCity(item.city)) continue;

    const cat = categoryMap.get(item.primaryCategoryId);
    if (!cat || cat.level !== 'primary' || !cat.slug) continue;

    const url = buildValidUrl(item.state, item.city, cat.slug);
    if (!url || addedUrls.has(url)) continue;

    addedUrls.add(url);
    l1Urls.push(url);
  }

  l1Urls.sort();
  const l1Path = join(OUTPUT_DIR, 'urls-l1.txt');
  writeFileSync(l1Path, l1Urls.join('\n') + '\n');
  console.log(`  L1: ${l1Urls.length} URLs → ${l1Path}`);

  // ── L2: Subcategory pages ───────────────────────────────────────────
  console.log('Generating L2 (subcategory) URLs...');
  const l2Urls: string[] = [];

  const subCounts = await prisma.business.groupBy({
    by: ['city', 'state', 'subcategoryId'],
    _count: { _all: true },
    where: { countryCode: 'US', subcategoryId: { not: null } },
  });

  for (const item of subCounts) {
    if (!item._count._all || !item.subcategoryId || !item.city || !item.state) continue;
    if (item._count._all < MIN_BUSINESS_COUNT) continue;
    if (isMalformedCity(item.city)) continue;

    const cat = categoryMap.get(item.subcategoryId);
    if (!cat || cat.level !== 'sub' || !cat.slug) continue;

    const url = buildValidUrl(item.state, item.city, cat.slug);
    if (!url || addedUrls.has(url)) continue;

    addedUrls.add(url);
    l2Urls.push(url);
  }

  l2Urls.sort();
  const l2Path = join(OUTPUT_DIR, 'urls-l2.txt');
  writeFileSync(l2Path, l2Urls.join('\n') + '\n');
  console.log(`  L2: ${l2Urls.length} URLs → ${l2Path}`);

  // ── L3: Business detail pages ───────────────────────────────────────
  console.log('Generating L3 (business detail) URLs...');
  const l3Urls: string[] = [];
  const l3Added = new Set<string>();

  const businesses = await prisma.business.findMany({
    where: {
      slug: { not: null },
      googlePlace: {
        rating: { gte: 4.2 },
        userRatingsTotal: { gte: 10 },
        fetchStatus: 'ok',
      },
    },
    select: { slug: true },
    take: 50000,
  });

  for (const biz of businesses) {
    const slug = normalizeSlug(biz.slug);
    if (!slug) continue;
    const url = `${BASE_URL}/biz/${slug}`;
    if (l3Added.has(url)) continue;
    l3Added.add(url);
    l3Urls.push(url);
  }

  l3Urls.sort();
  const l3Path = join(OUTPUT_DIR, 'urls-l3.txt');
  writeFileSync(l3Path, l3Urls.join('\n') + '\n');
  console.log(`  L3: ${l3Urls.length} URLs → ${l3Path}`);

  // ── Summary ─────────────────────────────────────────────────────────
  console.log('\n=== Summary ===');
  console.log(`  L1 (primary categories): ${l1Urls.length}`);
  console.log(`  L2 (subcategories):      ${l2Urls.length}`);
  console.log(`  L3 (businesses):         ${l3Urls.length}`);
  console.log(`  Total:                   ${l1Urls.length + l2Urls.length + l3Urls.length}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
