/**
 * Fix KoreaDaily Subcategory Mapping
 * Remaps ~28,000+ KoreaDaily businesses to correct subcategories
 * Also fixes RadioKorea B30 (종합병원) and B34 (일반치과) subcategories
 *
 * Run: npx tsx scripts/fix-subcategories.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { KOREADAILY_SUB_MAPPING, mapRadioKoreaCategory } from '../../src/lib/taxonomy/categoryMapping';

const prisma = new PrismaClient();

interface SourceKey {
  source: string;
  uid: string;
}

interface KoreaDailyEntry {
  ypl_id: number;
  ypl_kname: string;
  category_id: number;
  sub_idx: number;
  sub_name: string;
}

interface RadioKoreaBusiness {
  uid: string;
  name: string;
  category_code: string;
  category_name: string;
}

// New subcategories to ensure exist in the DB
const NEW_SUBCATEGORIES = [
  { slug: 'general-hospital', nameKo: '종합병원', nameEn: 'General Hospital', parent: 'medical' },
  { slug: 'optometrist', nameKo: '검안의', nameEn: 'Optometrist', parent: 'medical' },
  { slug: 'nightlife', nameKo: '나이트라이프', nameEn: 'Nightlife', parent: 'food' },
  { slug: 'chicken-pizza', nameKo: '치킨/피자', nameEn: 'Chicken & Pizza', parent: 'food' },
  { slug: 'laundry', nameKo: '세탁', nameEn: 'Laundry', parent: 'home-services' },
  { slug: 'shipping', nameKo: '택배', nameEn: 'Shipping', parent: 'home-services' },
  { slug: 'handyman', nameKo: '핸디맨', nameEn: 'Handyman', parent: 'home-services' },
  { slug: 'taxi', nameKo: '택시', nameEn: 'Taxi', parent: 'auto' },
];

const BATCH_SIZE = 100;

async function main() {
  console.log('=== Fix KoreaDaily Subcategory Mapping ===\n');

  // ────────────────────────────────────────────
  // Phase 0: Before Snapshot
  // ────────────────────────────────────────────
  console.log('Phase 0: Before snapshot...\n');

  const beforeNullCount = await prisma.business.count({
    where: { subcategoryId: null },
  });
  const beforeTotal = await prisma.business.count();
  console.log(`  Total businesses: ${beforeTotal}`);
  console.log(`  subcategoryId=NULL: ${beforeNullCount} (${((beforeNullCount / beforeTotal) * 100).toFixed(1)}%)\n`);

  const beforeGroups = await prisma.business.groupBy({
    by: ['primaryCategoryId', 'subcategoryId'],
    _count: true,
  });
  const beforeNullByPrimary = beforeGroups
    .filter(g => g.subcategoryId === null)
    .sort((a, b) => b._count - a._count);

  const allCategories = await prisma.category.findMany();
  const categoryById = new Map(allCategories.map(c => [c.id, c]));

  console.log('  NULL subcategory by primary category:');
  for (const g of beforeNullByPrimary) {
    const cat = categoryById.get(g.primaryCategoryId);
    console.log(`    ${cat?.nameKo || 'unknown'} (${cat?.slug}): ${g._count}`);
  }
  console.log();

  // ────────────────────────────────────────────
  // Phase 1: Ensure new subcategories exist in DB
  // ────────────────────────────────────────────
  console.log('Phase 1: Ensuring new subcategories exist in DB...\n');

  const categoryBySlug = new Map(allCategories.map(c => [c.slug, c]));
  let subcategoriesCreated = 0;

  for (const sub of NEW_SUBCATEGORIES) {
    const existing = categoryBySlug.get(sub.slug);
    if (existing) {
      console.log(`  ✓ ${sub.slug} already exists (id=${existing.id})`);
      continue;
    }

    const parent = categoryBySlug.get(sub.parent);
    if (!parent) {
      console.error(`  ✗ Parent category '${sub.parent}' not found for ${sub.slug}!`);
      continue;
    }

    const created = await prisma.category.create({
      data: {
        slug: sub.slug,
        nameKo: sub.nameKo,
        nameEn: sub.nameEn,
        level: 'sub',
        parentId: parent.id,
      },
    });
    categoryBySlug.set(created.slug, created);
    categoryById.set(created.id, created);
    subcategoriesCreated++;
    console.log(`  + Created ${sub.slug} (id=${created.id}, parent=${sub.parent})`);
  }
  console.log(`  ${subcategoriesCreated} new subcategories created\n`);

  // ────────────────────────────────────────────
  // Phase 2: Build lookup maps
  // ────────────────────────────────────────────
  console.log('Phase 2: Building lookup maps...\n');

  // KoreaDaily: ypl_id -> { category_id, sub_idx }
  const koreadailyDataPath = path.resolve(__dirname, '../../scraped_koreadaily_yp_complete.json');
  const koreadailyRaw = fs.readFileSync(koreadailyDataPath, 'utf-8');
  const koreadailyData: KoreaDailyEntry[] = JSON.parse(koreadailyRaw);
  const koreadailyMap = new Map<string, { category_id: number; sub_idx: number }>();
  for (const entry of koreadailyData) {
    koreadailyMap.set(String(entry.ypl_id), {
      category_id: entry.category_id,
      sub_idx: entry.sub_idx,
    });
  }
  console.log(`  KoreaDaily lookup map: ${koreadailyMap.size} entries`);

  // RadioKorea: uid -> category_code
  const radiokoreaDataPath = path.resolve(__dirname, '../../radiokorea_businesses_v2.json');
  const radiokoreaRaw = fs.readFileSync(radiokoreaDataPath, 'utf-8');
  const radiokoreaData = JSON.parse(radiokoreaRaw);
  const radiokoreaBusinesses: RadioKoreaBusiness[] = radiokoreaData.businesses || radiokoreaData;
  const radiokoreaMap = new Map<string, string>();
  for (const biz of radiokoreaBusinesses) {
    radiokoreaMap.set(biz.uid, biz.category_code);
  }
  console.log(`  RadioKorea lookup map: ${radiokoreaMap.size} entries`);

  // Slug -> category ID
  const slugToId = new Map<string, number>();
  for (const cat of categoryBySlug.values()) {
    slugToId.set(cat.slug, cat.id);
  }
  console.log(`  Category slug->id map: ${slugToId.size} entries\n`);

  // ────────────────────────────────────────────
  // Phase 3: KoreaDaily business remapping
  // ────────────────────────────────────────────
  console.log('Phase 3: Remapping KoreaDaily businesses...\n');

  const allBusinesses = await prisma.business.findMany({
    select: {
      id: true,
      nameKo: true,
      subcategoryId: true,
      sourceKeys: true,
    },
  });

  const kdStats = {
    total: 0,
    mapped: 0,
    noSourceData: 0,
    noMapping: 0,
    alreadyCorrect: 0,
    updated: 0,
    errors: 0,
    slugNotFound: 0,
  };

  const updates: Array<{ id: number; subcategoryId: number }> = [];

  for (const biz of allBusinesses) {
    const sourceKeys = (biz.sourceKeys as SourceKey[] | null) || [];
    const kdKey = sourceKeys.find(sk => sk.source === 'koreadaily');
    if (!kdKey) continue;

    kdStats.total++;

    const sourceData = koreadailyMap.get(kdKey.uid);
    if (!sourceData) {
      kdStats.noSourceData++;
      continue;
    }

    const subKey = `${sourceData.category_id}-${sourceData.sub_idx}`;
    const subSlug = KOREADAILY_SUB_MAPPING[subKey];
    if (!subSlug) {
      kdStats.noMapping++;
      continue;
    }

    kdStats.mapped++;

    const newSubcategoryId = slugToId.get(subSlug);
    if (!newSubcategoryId) {
      kdStats.slugNotFound++;
      console.warn(`  Slug not found in DB: ${subSlug} (key=${subKey})`);
      continue;
    }

    if (biz.subcategoryId === newSubcategoryId) {
      kdStats.alreadyCorrect++;
      continue;
    }

    updates.push({ id: biz.id, subcategoryId: newSubcategoryId });
  }

  console.log(`  KoreaDaily businesses found: ${kdStats.total}`);
  console.log(`  Mapped to subcategory: ${kdStats.mapped}`);
  console.log(`  No source data (ypl_id not in JSON): ${kdStats.noSourceData}`);
  console.log(`  No mapping (sub_idx in SKIP list): ${kdStats.noMapping}`);
  console.log(`  Slug not found in DB: ${kdStats.slugNotFound}`);
  console.log(`  Already correct: ${kdStats.alreadyCorrect}`);
  console.log(`  To update: ${updates.length}\n`);

  // Batch update
  console.log(`  Updating in batches of ${BATCH_SIZE}...`);
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(u =>
        prisma.business.update({
          where: { id: u.id },
          data: { subcategoryId: u.subcategoryId },
        })
      )
    );
    kdStats.updated += batch.length;
    if ((i + BATCH_SIZE) % 5000 < BATCH_SIZE) {
      console.log(`    ${Math.min(i + BATCH_SIZE, updates.length)} / ${updates.length}`);
    }
  }
  console.log(`  KoreaDaily updates complete: ${kdStats.updated}\n`);

  // ────────────────────────────────────────────
  // Phase 4: RadioKorea B30/B34 remapping
  // ────────────────────────────────────────────
  console.log('Phase 4: Remapping RadioKorea B30/B34...\n');

  const rkStats = {
    total: 0,
    b30Updated: 0,
    b34Updated: 0,
    errors: 0,
  };

  const rkUpdates: Array<{ id: number; subcategoryId: number }> = [];

  const generalHospitalId = slugToId.get('general-hospital');
  const generalDentistId = slugToId.get('general-dentist');

  if (!generalHospitalId) {
    console.error('  ✗ general-hospital not found in DB!');
  }
  if (!generalDentistId) {
    console.error('  ✗ general-dentist not found in DB!');
  }

  for (const biz of allBusinesses) {
    const sourceKeys = (biz.sourceKeys as SourceKey[] | null) || [];
    const rkKey = sourceKeys.find(sk => sk.source === 'radiokorea');
    if (!rkKey) continue;

    rkStats.total++;

    const categoryCode = radiokoreaMap.get(rkKey.uid);
    if (!categoryCode) continue;

    if (categoryCode === 'B30' && generalHospitalId && biz.subcategoryId !== generalHospitalId) {
      rkUpdates.push({ id: biz.id, subcategoryId: generalHospitalId });
      rkStats.b30Updated++;
    } else if (categoryCode === 'B34' && generalDentistId && biz.subcategoryId !== generalDentistId) {
      rkUpdates.push({ id: biz.id, subcategoryId: generalDentistId });
      rkStats.b34Updated++;
    }
  }

  console.log(`  RadioKorea businesses found: ${rkStats.total}`);
  console.log(`  B30 (종합병원) to update: ${rkStats.b30Updated}`);
  console.log(`  B34 (일반치과) to update: ${rkStats.b34Updated}`);

  // Batch update
  for (let i = 0; i < rkUpdates.length; i += BATCH_SIZE) {
    const batch = rkUpdates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(u =>
        prisma.business.update({
          where: { id: u.id },
          data: { subcategoryId: u.subcategoryId },
        })
      )
    );
  }
  console.log(`  RadioKorea updates complete: ${rkUpdates.length}\n`);

  // ────────────────────────────────────────────
  // Phase 5: After Snapshot + Report
  // ────────────────────────────────────────────
  console.log('Phase 5: After snapshot...\n');

  const afterNullCount = await prisma.business.count({
    where: { subcategoryId: null },
  });
  const afterTotal = await prisma.business.count();
  console.log(`  Total businesses: ${afterTotal}`);
  console.log(`  subcategoryId=NULL: ${afterNullCount} (${((afterNullCount / afterTotal) * 100).toFixed(1)}%)\n`);

  const afterGroups = await prisma.business.groupBy({
    by: ['primaryCategoryId', 'subcategoryId'],
    _count: true,
  });
  const afterNullByPrimary = afterGroups
    .filter(g => g.subcategoryId === null)
    .sort((a, b) => b._count - a._count);

  console.log('  NULL subcategory by primary category (after):');
  for (const g of afterNullByPrimary) {
    const cat = categoryById.get(g.primaryCategoryId);
    console.log(`    ${cat?.nameKo || 'unknown'} (${cat?.slug}): ${g._count}`);
  }

  // Summary
  console.log('\n=== Summary ===\n');
  console.log(`  Before: ${beforeNullCount} NULL (${((beforeNullCount / beforeTotal) * 100).toFixed(1)}%)`);
  console.log(`  After:  ${afterNullCount} NULL (${((afterNullCount / afterTotal) * 100).toFixed(1)}%)`);
  console.log(`  Reduction: ${beforeNullCount - afterNullCount} businesses gained subcategory`);
  console.log(`  New subcategories created: ${subcategoriesCreated}`);
  console.log(`  KoreaDaily updates: ${kdStats.updated}`);
  console.log(`  RadioKorea updates: ${rkUpdates.length}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
