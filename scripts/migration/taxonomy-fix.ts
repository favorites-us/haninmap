/**
 * Taxonomy Fix Script
 * Implements targeted category fixes B1-B6
 * Run: npx tsx scripts/taxonomy-fix.ts
 *
 * Changes:
 * B1: RadioKorea B10 검안의 -> medical>optometrist (new)
 * B2: KoreaDaily cat 13 건강식품 -> shopping>health-supplements (new) / medical>korean-medicine
 * B3: S07 세탁소 -> home-services>laundry (new)
 * B4: S03 gym/fitness -> community>fitness (new)
 * B5: N01/N03 nightlife -> food>nightlife (new)
 * B6: A33/T01 logistics split -> shipping, logistics (new)
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SourceKey {
  source: string;
  uid: string;
}

interface FixResult {
  timestamp: string;
  newSubcategories: string[];
  changes: {
    category: string;
    description: string;
    affected: number;
    samples: Array<{ id: number; nameKo: string; oldCategory: string; newCategory: string }>;
  }[];
  summary: {
    totalAffected: number;
    newSubcategoriesCreated: number;
  };
}

// Keyword rules for B2 (KoreaDaily category 13 건강식품)
const KOREAN_MEDICINE_KEYWORDS = [
  '한의원', '한의사', '침', '뜸', '진료', '치료', '한방', '한약방', '보약', '탕약',
  '한방병원', '한의학', '경락', '체질', '동의보감'
];

// Keyword rules for B4 (fitness split from spa)
const FITNESS_KEYWORDS = [
  '헬스', '피트니스', 'gym', 'fitness', '체육관', '스포츠센터', '헬스클럽',
  '웨이트', '트레이닝', '운동', 'health club', 'sports center'
];

// Keyword rules for B5 (nightlife)
const NIGHTLIFE_KEYWORDS = [
  '노래방', '가라오케', 'karaoke', '룸싸롱', '룸살롱', '나이트', '나이트클럽',
  '캬바레', '클럽', 'nightclub', 'lounge', '라운지', '술집', '바', '펍'
];

// Keyword rules for B6 (logistics split)
const SHIPPING_KEYWORDS = ['택배', '배송', '퀵', '배달', 'delivery', 'courier', 'express'];
const LOGISTICS_KEYWORDS = ['창고', '통관', '수출입', '화물', '물류', 'warehouse', 'customs', 'freight', 'logistics'];

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some(kw => lowerText.includes(kw.toLowerCase()));
}

async function main() {
  console.log('=== Taxonomy Fix Script ===\n');
  console.log('This script will create new subcategories and remap affected businesses.\n');

  const result: FixResult = {
    timestamp: new Date().toISOString(),
    newSubcategories: [],
    changes: [],
    summary: {
      totalAffected: 0,
      newSubcategoriesCreated: 0,
    },
  };

  // Get parent category IDs
  const categories = await prisma.category.findMany({
    where: { level: 'primary' },
    select: { id: true, slug: true },
  });
  const categoryMap = new Map(categories.map(c => [c.slug, c.id]));

  const medicalId = categoryMap.get('medical')!;
  const shoppingId = categoryMap.get('shopping')!;
  const homeServicesId = categoryMap.get('home-services')!;
  const communityId = categoryMap.get('community')!;
  const foodId = categoryMap.get('food')!;

  // ============================================
  // Step 1: Create new subcategories
  // ============================================
  console.log('Step 1: Creating new subcategories...\n');

  const newSubcategories = [
    // B1: Optometrist
    { slug: 'optometrist', nameKo: '검안의', nameEn: 'Optometrist', parentId: medicalId },
    // B2: Health Supplements
    { slug: 'health-supplements', nameKo: '건강식품', nameEn: 'Health Supplements', parentId: shoppingId },
    // B3: Laundry
    { slug: 'laundry', nameKo: '세탁소', nameEn: 'Laundry', parentId: homeServicesId },
    // B4: Fitness
    { slug: 'fitness', nameKo: '피트니스', nameEn: 'Fitness', parentId: communityId },
    // B5: Nightlife
    { slug: 'nightlife', nameKo: '유흥', nameEn: 'Nightlife', parentId: foodId },
    // B6: Shipping & Logistics
    { slug: 'shipping', nameKo: '배송/택배', nameEn: 'Shipping', parentId: homeServicesId },
    { slug: 'logistics', nameKo: '물류/창고', nameEn: 'Logistics', parentId: homeServicesId },
  ];

  for (const sub of newSubcategories) {
    const existing = await prisma.category.findUnique({ where: { slug: sub.slug } });
    if (!existing) {
      await prisma.category.create({
        data: {
          slug: sub.slug,
          nameKo: sub.nameKo,
          nameEn: sub.nameEn,
          level: 'sub',
          parentId: sub.parentId,
        },
      });
      console.log(`  Created: ${sub.slug} (${sub.nameKo})`);
      result.newSubcategories.push(sub.slug);
      result.summary.newSubcategoriesCreated++;
    } else {
      console.log(`  Exists: ${sub.slug}`);
    }
  }

  // Refresh category map with new subcategories
  const allCategories = await prisma.category.findMany({
    select: { id: true, slug: true },
  });
  const subcatMap = new Map(allCategories.map(c => [c.slug, c.id]));

  // ============================================
  // B1: RadioKorea B10 검안의 -> medical>optometrist
  // ============================================
  console.log('\n--- B1: RadioKorea B10 검안의 ---');

  // Find businesses with 검안 in name currently in medical>ophthalmology
  const ophthalmologyId = subcatMap.get('ophthalmology');
  const optometristId = subcatMap.get('optometrist');

  if (ophthalmologyId && optometristId) {
    const b10Businesses = await prisma.business.findMany({
      where: {
        subcategoryId: ophthalmologyId,
        nameKo: { contains: '검안' },
      },
      select: { id: true, nameKo: true, subcategory: { select: { slug: true } } },
    });

    if (b10Businesses.length > 0) {
      const samples = b10Businesses.slice(0, 5).map(b => ({
        id: b.id,
        nameKo: b.nameKo,
        oldCategory: 'ophthalmology',
        newCategory: 'optometrist',
      }));

      await prisma.business.updateMany({
        where: { id: { in: b10Businesses.map(b => b.id) } },
        data: { subcategoryId: optometristId },
      });

      console.log(`  Moved ${b10Businesses.length} businesses from ophthalmology to optometrist`);
      result.changes.push({
        category: 'B1: 검안의',
        description: 'RadioKorea B10 검안의 moved from ophthalmology to optometrist',
        affected: b10Businesses.length,
        samples,
      });
      result.summary.totalAffected += b10Businesses.length;
    } else {
      console.log('  No businesses found matching criteria');
    }
  }

  // ============================================
  // B2: KoreaDaily category 13 건강식품 split
  // ============================================
  console.log('\n--- B2: KoreaDaily category 13 건강식품 ---');

  const healthSupplementsId = subcatMap.get('health-supplements');
  const koreanMedicineId = subcatMap.get('korean-medicine');

  if (healthSupplementsId && koreanMedicineId) {
    // Find businesses from KoreaDaily that might be health supplements currently in shopping
    // We'll look for businesses without subcategory in shopping that contain health-related keywords
    const shoppingNoSub = await prisma.business.findMany({
      where: {
        primaryCategoryId: shoppingId,
        subcategoryId: null,
      },
      select: {
        id: true,
        nameKo: true,
        nameEn: true,
        sourceKeys: true,
      },
    });

    const toHealthSupplements: number[] = [];
    const toKoreanMedicine: number[] = [];
    const healthSamples: Array<{ id: number; nameKo: string; oldCategory: string; newCategory: string }> = [];
    const medicineSamples: Array<{ id: number; nameKo: string; oldCategory: string; newCategory: string }> = [];

    for (const biz of shoppingNoSub) {
      const name = `${biz.nameKo} ${biz.nameEn || ''}`;

      // Check if it's from KoreaDaily
      const keys = (biz.sourceKeys as SourceKey[]) || [];
      const isKoreaDaily = keys.some(k => k.source === 'koreadaily');

      if (!isKoreaDaily) continue;

      // Check for Korean medicine signals first (higher priority)
      if (matchesKeywords(name, KOREAN_MEDICINE_KEYWORDS)) {
        toKoreanMedicine.push(biz.id);
        if (medicineSamples.length < 5) {
          medicineSamples.push({
            id: biz.id,
            nameKo: biz.nameKo,
            oldCategory: 'shopping (no sub)',
            newCategory: 'medical>korean-medicine',
          });
        }
      }
      // Then check for health supplement keywords
      else if (name.includes('건강') || name.includes('홍삼') || name.includes('인삼') ||
               name.includes('비타민') || name.includes('영양') || name.includes('보조식품') ||
               name.includes('흑염소') || name.includes('녹용') || name.includes('꿀') ||
               name.includes('허벌') || name.includes('health')) {
        toHealthSupplements.push(biz.id);
        if (healthSamples.length < 5) {
          healthSamples.push({
            id: biz.id,
            nameKo: biz.nameKo,
            oldCategory: 'shopping (no sub)',
            newCategory: 'shopping>health-supplements',
          });
        }
      }
    }

    if (toHealthSupplements.length > 0) {
      await prisma.business.updateMany({
        where: { id: { in: toHealthSupplements } },
        data: { subcategoryId: healthSupplementsId },
      });
      console.log(`  Assigned ${toHealthSupplements.length} to health-supplements`);
      result.changes.push({
        category: 'B2: 건강식품 -> health-supplements',
        description: 'KoreaDaily category 13 health supplements',
        affected: toHealthSupplements.length,
        samples: healthSamples,
      });
      result.summary.totalAffected += toHealthSupplements.length;
    }

    if (toKoreanMedicine.length > 0) {
      await prisma.business.updateMany({
        where: { id: { in: toKoreanMedicine } },
        data: {
          primaryCategoryId: medicalId,
          subcategoryId: koreanMedicineId,
        },
      });
      console.log(`  Moved ${toKoreanMedicine.length} to medical>korean-medicine`);
      result.changes.push({
        category: 'B2: 건강식품 -> korean-medicine',
        description: 'KoreaDaily category 13 Korean medicine clinics',
        affected: toKoreanMedicine.length,
        samples: medicineSamples,
      });
      result.summary.totalAffected += toKoreanMedicine.length;
    }
  }

  // ============================================
  // B3: S07 세탁소 -> home-services>laundry
  // ============================================
  console.log('\n--- B3: S07 세탁소 -> home-services>laundry ---');

  const laundryId = subcatMap.get('laundry');
  const professionalId = categoryMap.get('professional');

  if (laundryId && professionalId) {
    // Find laundry businesses in professional category
    const laundryBusinesses = await prisma.business.findMany({
      where: {
        primaryCategoryId: professionalId,
        OR: [
          { nameKo: { contains: '세탁' } },
          { nameKo: { contains: '드라이' } },
          { nameKo: { contains: '클리닝' } },
          { nameKo: { contains: '빨래' } },
        ],
      },
      select: { id: true, nameKo: true },
    });

    if (laundryBusinesses.length > 0) {
      const samples = laundryBusinesses.slice(0, 5).map(b => ({
        id: b.id,
        nameKo: b.nameKo,
        oldCategory: 'professional',
        newCategory: 'home-services>laundry',
      }));

      await prisma.business.updateMany({
        where: { id: { in: laundryBusinesses.map(b => b.id) } },
        data: {
          primaryCategoryId: homeServicesId,
          subcategoryId: laundryId,
        },
      });

      console.log(`  Moved ${laundryBusinesses.length} laundry businesses to home-services>laundry`);
      result.changes.push({
        category: 'B3: 세탁소',
        description: 'Laundry businesses moved from professional to home-services>laundry',
        affected: laundryBusinesses.length,
        samples,
      });
      result.summary.totalAffected += laundryBusinesses.length;
    } else {
      console.log('  No laundry businesses found in professional category');
    }
  }

  // ============================================
  // B4: S03 gym/fitness -> community>fitness
  // ============================================
  console.log('\n--- B4: Gym/Fitness -> community>fitness ---');

  const fitnessId = subcatMap.get('fitness');
  const spaId = subcatMap.get('spa');
  const beautyId = categoryMap.get('beauty');

  if (fitnessId && beautyId) {
    // Find fitness/gym businesses in beauty category
    const fitnessBusinesses = await prisma.business.findMany({
      where: {
        primaryCategoryId: beautyId,
        OR: FITNESS_KEYWORDS.map(kw => ({ nameKo: { contains: kw } })),
      },
      select: { id: true, nameKo: true },
    });

    // Filter to exclude actual spa/sauna businesses
    const actualFitness = fitnessBusinesses.filter(b => {
      const name = b.nameKo.toLowerCase();
      return !name.includes('사우나') && !name.includes('스파') && !name.includes('찜질');
    });

    if (actualFitness.length > 0) {
      const samples = actualFitness.slice(0, 5).map(b => ({
        id: b.id,
        nameKo: b.nameKo,
        oldCategory: 'beauty',
        newCategory: 'community>fitness',
      }));

      await prisma.business.updateMany({
        where: { id: { in: actualFitness.map(b => b.id) } },
        data: {
          primaryCategoryId: communityId,
          subcategoryId: fitnessId,
        },
      });

      console.log(`  Moved ${actualFitness.length} fitness businesses to community>fitness`);
      result.changes.push({
        category: 'B4: Fitness',
        description: 'Gym/fitness businesses moved from beauty to community>fitness',
        affected: actualFitness.length,
        samples,
      });
      result.summary.totalAffected += actualFitness.length;
    } else {
      console.log('  No fitness businesses found to move');
    }
  }

  // ============================================
  // B5: N01/N03 nightlife -> food>nightlife
  // ============================================
  console.log('\n--- B5: Nightlife -> food>nightlife ---');

  const nightlifeId = subcatMap.get('nightlife');

  if (nightlifeId) {
    // Find nightlife businesses in food category without proper subcategory
    const nightlifeBusinesses = await prisma.business.findMany({
      where: {
        primaryCategoryId: foodId,
        subcategoryId: null,
        OR: NIGHTLIFE_KEYWORDS.map(kw => ({ nameKo: { contains: kw } })),
      },
      select: { id: true, nameKo: true },
    });

    if (nightlifeBusinesses.length > 0) {
      const samples = nightlifeBusinesses.slice(0, 5).map(b => ({
        id: b.id,
        nameKo: b.nameKo,
        oldCategory: 'food (no sub)',
        newCategory: 'food>nightlife',
      }));

      await prisma.business.updateMany({
        where: { id: { in: nightlifeBusinesses.map(b => b.id) } },
        data: { subcategoryId: nightlifeId },
      });

      console.log(`  Assigned ${nightlifeBusinesses.length} nightlife businesses to food>nightlife`);
      result.changes.push({
        category: 'B5: Nightlife',
        description: 'Nightlife businesses assigned to food>nightlife subcategory',
        affected: nightlifeBusinesses.length,
        samples,
      });
      result.summary.totalAffected += nightlifeBusinesses.length;
    } else {
      console.log('  No nightlife businesses found without subcategory');
    }
  }

  // ============================================
  // B6: A33/T01 logistics split
  // ============================================
  console.log('\n--- B6: Logistics split ---');

  const movingId = subcatMap.get('moving');
  const shippingId = subcatMap.get('shipping');
  const logisticsId = subcatMap.get('logistics');

  if (movingId && shippingId && logisticsId) {
    // Find businesses in home-services>moving that should be shipping or logistics
    const movingBusinesses = await prisma.business.findMany({
      where: {
        primaryCategoryId: homeServicesId,
        subcategoryId: movingId,
      },
      select: { id: true, nameKo: true, nameEn: true },
    });

    const toShipping: number[] = [];
    const toLogistics: number[] = [];
    const shippingSamples: Array<{ id: number; nameKo: string; oldCategory: string; newCategory: string }> = [];
    const logisticsSamples: Array<{ id: number; nameKo: string; oldCategory: string; newCategory: string }> = [];

    for (const biz of movingBusinesses) {
      const name = `${biz.nameKo} ${biz.nameEn || ''}`;

      if (matchesKeywords(name, LOGISTICS_KEYWORDS)) {
        toLogistics.push(biz.id);
        if (logisticsSamples.length < 5) {
          logisticsSamples.push({
            id: biz.id,
            nameKo: biz.nameKo,
            oldCategory: 'moving',
            newCategory: 'logistics',
          });
        }
      } else if (matchesKeywords(name, SHIPPING_KEYWORDS)) {
        toShipping.push(biz.id);
        if (shippingSamples.length < 5) {
          shippingSamples.push({
            id: biz.id,
            nameKo: biz.nameKo,
            oldCategory: 'moving',
            newCategory: 'shipping',
          });
        }
      }
    }

    if (toShipping.length > 0) {
      await prisma.business.updateMany({
        where: { id: { in: toShipping } },
        data: { subcategoryId: shippingId },
      });
      console.log(`  Moved ${toShipping.length} to shipping`);
      result.changes.push({
        category: 'B6: Shipping',
        description: 'Courier/parcel businesses split from moving to shipping',
        affected: toShipping.length,
        samples: shippingSamples,
      });
      result.summary.totalAffected += toShipping.length;
    }

    if (toLogistics.length > 0) {
      await prisma.business.updateMany({
        where: { id: { in: toLogistics } },
        data: { subcategoryId: logisticsId },
      });
      console.log(`  Moved ${toLogistics.length} to logistics`);
      result.changes.push({
        category: 'B6: Logistics',
        description: 'Warehouse/customs businesses split from moving to logistics',
        affected: toLogistics.length,
        samples: logisticsSamples,
      });
      result.summary.totalAffected += toLogistics.length;
    }
  }

  // ============================================
  // Write reports
  // ============================================
  console.log('\n=== Writing Reports ===');

  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(reportsDir, 'taxonomy_fix_result.json'),
    JSON.stringify(result, null, 2)
  );

  // Markdown report
  let md = `# Taxonomy Fix Results\n\n`;
  md += `**Timestamp:** ${result.timestamp}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| New Subcategories Created | ${result.summary.newSubcategoriesCreated} |\n`;
  md += `| Total Records Affected | ${result.summary.totalAffected} |\n\n`;

  if (result.newSubcategories.length > 0) {
    md += `## New Subcategories\n\n`;
    md += result.newSubcategories.map(s => `- ${s}`).join('\n') + '\n\n';
  }

  md += `## Changes by Category\n\n`;
  for (const change of result.changes) {
    md += `### ${change.category}\n\n`;
    md += `**Description:** ${change.description}\n\n`;
    md += `**Affected:** ${change.affected} records\n\n`;
    if (change.samples.length > 0) {
      md += `**Samples:**\n\n`;
      md += `| ID | Name | Old | New |\n|-----|------|-----|-----|\n`;
      for (const s of change.samples) {
        md += `| ${s.id} | ${s.nameKo.substring(0, 30)} | ${s.oldCategory} | ${s.newCategory} |\n`;
      }
      md += '\n';
    }
  }

  fs.writeFileSync(path.join(reportsDir, 'taxonomy_fix_result.md'), md);

  console.log('\nReports written to:');
  console.log('  - reports/taxonomy_fix_result.json');
  console.log('  - reports/taxonomy_fix_result.md');

  console.log(`\n=== Completed ===`);
  console.log(`New subcategories: ${result.summary.newSubcategoriesCreated}`);
  console.log(`Total affected: ${result.summary.totalAffected}`);

  await prisma.$disconnect();
}

main().catch(console.error);
