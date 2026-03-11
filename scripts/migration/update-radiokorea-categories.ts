/**
 * Update RadioKorea business categories from v2 crawl data
 * Run with: npx tsx scripts/update-radiokorea-categories.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { mapRadioKoreaCategory } from '../../src/lib/taxonomy/categoryMapping';

const prisma = new PrismaClient();

// Path to v2 crawl data
const RADIOKOREA_V2_FILE = path.resolve(__dirname, '../../radiokorea_businesses_v2.json');

interface RadioKoreaBusiness {
  uid: string;
  name: string;
  name_en?: string;
  category_code: string;
  category_name: string;
}

interface SourceKey {
  source: string;
  uid: string;
}

async function updateCategories() {
  console.log('Starting RadioKorea category update from v2 crawl...\n');

  // Load v2 crawl data
  const rawData = fs.readFileSync(RADIOKOREA_V2_FILE, 'utf-8');
  const data = JSON.parse(rawData);
  const businesses: RadioKoreaBusiness[] = data.businesses || data;

  console.log(`Loaded ${businesses.length} businesses from v2 crawl\n`);

  // Create a map of uid -> category_code from v2 data
  const v2CategoryMap = new Map<string, { code: string; name: string }>();
  for (const biz of businesses) {
    v2CategoryMap.set(biz.uid, {
      code: biz.category_code,
      name: biz.category_name,
    });
  }

  console.log(`Created category map with ${v2CategoryMap.size} entries\n`);

  // Get all category IDs
  const categories = await prisma.category.findMany();
  const categoryMap = new Map(categories.map(c => [c.slug, c.id]));

  console.log(`Loaded ${categories.length} categories from database\n`);

  // Get all RadioKorea businesses from database
  const dbBusinesses = await prisma.business.findMany({
    select: {
      id: true,
      nameKo: true,
      primaryCategoryId: true,
      subcategoryId: true,
      sourceKeys: true,
      primaryCategory: { select: { slug: true, nameKo: true } },
    }
  });

  console.log(`Found ${dbBusinesses.length} businesses in database\n`);

  const stats = {
    total: 0,
    updated: 0,
    notFound: 0,
    unchanged: 0,
    errors: 0,
  };

  const transitions: Map<string, number> = new Map();

  for (const biz of dbBusinesses) {
    // Get RadioKorea uid from sourceKeys
    const sourceKeys = biz.sourceKeys as SourceKey[] | null;
    if (!sourceKeys) continue;

    const radiokoreaKey = sourceKeys.find(sk => sk.source === 'radiokorea');
    if (!radiokoreaKey) continue;

    stats.total++;

    // Look up in v2 data
    const v2Category = v2CategoryMap.get(radiokoreaKey.uid);
    if (!v2Category) {
      stats.notFound++;
      continue;
    }

    // Map to our taxonomy
    const mapping = mapRadioKoreaCategory(v2Category.code);
    const newPrimaryCategoryId = categoryMap.get(mapping.primary);
    const newSubcategoryId = mapping.sub ? categoryMap.get(mapping.sub) : null;

    if (!newPrimaryCategoryId) {
      console.warn(`Unknown category: ${mapping.primary} for code ${v2Category.code}`);
      stats.errors++;
      continue;
    }

    // Check if update needed
    if (biz.primaryCategoryId === newPrimaryCategoryId &&
        biz.subcategoryId === newSubcategoryId) {
      stats.unchanged++;
      continue;
    }

    // Track transition
    const fromCat = biz.primaryCategory?.nameKo || 'unknown';
    const toCat = mapping.primary;
    const key = `${fromCat} -> ${toCat}`;
    transitions.set(key, (transitions.get(key) || 0) + 1);

    // Update
    try {
      await prisma.business.update({
        where: { id: biz.id },
        data: {
          primaryCategoryId: newPrimaryCategoryId,
          subcategoryId: newSubcategoryId,
        }
      });
      stats.updated++;
    } catch (error) {
      console.error(`Error updating business ${biz.id}:`, error);
      stats.errors++;
    }
  }

  // Print results
  console.log('\n=== Update Summary ===\n');
  console.log(`Total RadioKorea businesses: ${stats.total}`);
  console.log(`Updated: ${stats.updated}`);
  console.log(`Unchanged: ${stats.unchanged}`);
  console.log(`Not found in v2 data: ${stats.notFound}`);
  console.log(`Errors: ${stats.errors}`);

  if (transitions.size > 0) {
    console.log('\n=== Category Transitions ===\n');
    const sorted = Array.from(transitions.entries()).sort((a, b) => b[1] - a[1]);
    for (const [key, count] of sorted) {
      console.log(`${key}: ${count}`);
    }
  }

  // Print final category counts
  console.log('\n=== Final Category Counts ===\n');
  const categoryCounts = await prisma.business.groupBy({
    by: ['primaryCategoryId'],
    _count: true,
    orderBy: { _count: { primaryCategoryId: 'desc' } }
  });

  for (const count of categoryCounts) {
    const cat = categories.find(c => c.id === count.primaryCategoryId);
    console.log(`${cat?.nameKo || 'unknown'} (${cat?.slug}): ${count._count}`);
  }
}

async function main() {
  try {
    await updateCategories();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
