/**
 * Check subcategory classification issues
 * Run with: npx tsx scripts/check-subcategories.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkSubcategories() {
  console.log('=== Checking Subcategory Classification ===\n');

  // Get all subcategories
  const subcategories = await prisma.category.findMany({
    where: { level: 'sub' },
    include: { parent: true }
  });

  for (const subcat of subcategories) {
    const businesses = await prisma.business.findMany({
      where: { subcategoryId: subcat.id },
      select: { id: true, nameKo: true, nameEn: true },
      take: 50
    });

    if (businesses.length === 0) continue;

    console.log(`\n=== ${subcat.nameKo} (${subcat.nameEn}) - ${subcat.parent?.nameKo} ===`);
    console.log(`Count: ${businesses.length}`);

    // Show first 10 examples
    businesses.slice(0, 10).forEach(b => {
      console.log(`  - ${b.nameKo} | ${b.nameEn}`);
    });
  }

  await prisma.$disconnect();
}

checkSubcategories();
