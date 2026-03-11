/**
 * Fix incorrectly categorized businesses
 * Run with: npx tsx scripts/fix-categories.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Keywords that indicate a travel agency
const TRAVEL_KEYWORDS = [
  '여행사', '여행', 'TRAVEL', 'TOUR', '관광', 'TOURISM',
  '투어', 'AIRLINE', '항공', 'TOURS'
];

// Keywords that indicate real estate
const REAL_ESTATE_KEYWORDS = [
  '부동산', 'REALTY', 'REAL ESTATE', 'REALTOR', 'PROPERTY',
  '에스크로', 'ESCROW', 'TITLE', '공인중개'
];

// Keywords that should NOT be in real estate
const NOT_REAL_ESTATE_KEYWORDS = [
  '여행', 'TRAVEL', 'TOUR', '관광', '항공', 'AIRLINE', '투어'
];

async function fixCategories() {
  console.log('Starting category fix...\n');

  // Get category IDs
  const categories = await prisma.category.findMany();
  const categoryMap = new Map(categories.map(c => [c.slug, c.id]));

  const travelCategoryId = categoryMap.get('travel');
  const realEstateCategoryId = categoryMap.get('real-estate');
  const travelAgencySubId = categoryMap.get('travel-agency');

  if (!travelCategoryId || !realEstateCategoryId) {
    console.error('Required categories not found!');
    return;
  }

  console.log(`Travel category ID: ${travelCategoryId}`);
  console.log(`Real Estate category ID: ${realEstateCategoryId}`);
  console.log(`Travel Agency subcategory ID: ${travelAgencySubId}\n`);

  // Find all businesses in real-estate category
  const realEstateBusinesses = await prisma.business.findMany({
    where: { primaryCategoryId: realEstateCategoryId },
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      primaryCategoryId: true,
    }
  });

  console.log(`Found ${realEstateBusinesses.length} businesses in Real Estate category\n`);

  let fixed = 0;
  const fixedNames: string[] = [];

  for (const biz of realEstateBusinesses) {
    const nameKo = biz.nameKo || '';
    const nameEn = (biz.nameEn || '').toUpperCase();
    const combinedName = `${nameKo} ${nameEn}`;

    // Check if this looks like a travel agency
    const isTravelAgency = TRAVEL_KEYWORDS.some(keyword =>
      combinedName.toUpperCase().includes(keyword.toUpperCase())
    );

    // Check if this is definitely NOT real estate (travel-related name)
    const isNotRealEstate = NOT_REAL_ESTATE_KEYWORDS.some(keyword =>
      combinedName.toUpperCase().includes(keyword.toUpperCase())
    );

    if (isTravelAgency || isNotRealEstate) {
      // Update to travel category
      await prisma.business.update({
        where: { id: biz.id },
        data: {
          primaryCategoryId: travelCategoryId,
          subcategoryId: travelAgencySubId || null,
        }
      });

      fixed++;
      fixedNames.push(`${biz.nameKo} | ${biz.nameEn}`);
    }
  }

  console.log(`\nFixed ${fixed} businesses from Real Estate to Travel:\n`);
  fixedNames.slice(0, 20).forEach(name => console.log(`  - ${name}`));
  if (fixedNames.length > 20) {
    console.log(`  ... and ${fixedNames.length - 20} more`);
  }

  // Also check other categories for misplaced travel agencies
  console.log('\n\nChecking other categories for travel agencies...\n');

  const otherBusinesses = await prisma.business.findMany({
    where: {
      primaryCategoryId: { not: travelCategoryId },
      OR: TRAVEL_KEYWORDS.map(keyword => ({
        OR: [
          { nameKo: { contains: keyword } },
          { nameEn: { contains: keyword, mode: 'insensitive' as const } },
        ]
      }))
    },
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      primaryCategoryId: true,
      primaryCategory: { select: { nameKo: true } }
    }
  });

  console.log(`Found ${otherBusinesses.length} potential travel agencies in other categories\n`);

  let otherFixed = 0;
  for (const biz of otherBusinesses) {
    const nameKo = biz.nameKo || '';
    const nameEn = (biz.nameEn || '').toUpperCase();
    const combinedName = `${nameKo} ${nameEn}`;

    // Strong indicators of travel agency
    const strongTravelIndicator =
      combinedName.includes('여행사') ||
      combinedName.toUpperCase().includes('TRAVEL SERVICE') ||
      combinedName.toUpperCase().includes('TRAVEL AGENCY') ||
      combinedName.toUpperCase().includes('TOUR SERVICE');

    if (strongTravelIndicator) {
      await prisma.business.update({
        where: { id: biz.id },
        data: {
          primaryCategoryId: travelCategoryId,
          subcategoryId: travelAgencySubId || null,
        }
      });

      otherFixed++;
      console.log(`  Fixed: ${biz.nameKo} | ${biz.nameEn} (was in ${biz.primaryCategory?.nameKo})`);
    }
  }

  console.log(`\nFixed ${otherFixed} additional travel agencies from other categories`);

  // Summary
  const totalFixed = fixed + otherFixed;
  console.log(`\n=== Summary ===`);
  console.log(`Total businesses re-categorized: ${totalFixed}`);

  // Verify
  const travelCount = await prisma.business.count({
    where: { primaryCategoryId: travelCategoryId }
  });
  const realEstateCount = await prisma.business.count({
    where: { primaryCategoryId: realEstateCategoryId }
  });

  console.log(`\nCurrent counts:`);
  console.log(`  Travel: ${travelCount}`);
  console.log(`  Real Estate: ${realEstateCount}`);
}

async function main() {
  try {
    await fixCategories();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
