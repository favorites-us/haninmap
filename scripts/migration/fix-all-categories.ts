/**
 * Comprehensive category fix based on business name patterns
 * Run with: npx tsx scripts/fix-all-categories.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Category detection patterns - order matters (more specific first)
const CATEGORY_PATTERNS: Array<{
  category: string;
  subcategory?: string;
  keywords: string[];
  excludeKeywords?: string[];
}> = [
  // LOCKSMITH -> home-services/locksmith
  {
    category: 'home-services',
    subcategory: 'locksmith',
    keywords: ['열쇠', 'LOCKSMITH', 'LOCK & SAFE', 'LOCK AND SAFE', 'KEY SERVICE', '락스미스'],
  },

  // TRAVEL -> travel/travel-agency
  {
    category: 'travel',
    subcategory: 'travel-agency',
    keywords: ['여행사', 'TRAVEL SERVICE', 'TRAVEL AGENCY', 'TOUR SERVICE', 'TOURS AND TRAVEL', 'TOUR & TRAVEL'],
    excludeKeywords: ['열쇠', 'LOCKSMITH', 'LOCK'],
  },

  // MOVING -> home-services/moving
  {
    category: 'home-services',
    subcategory: 'moving',
    keywords: ['이삿짐', '이사', 'MOVING', 'MOVER', '용달', '화물', '택배', 'EXPRESS DELIVERY'],
    excludeKeywords: ['여행', 'TRAVEL'],
  },

  // CONSTRUCTION -> home-services/construction
  {
    category: 'home-services',
    subcategory: 'construction',
    keywords: ['건축', '건설', 'CONSTRUCTION', 'CONTRACTOR', 'REMODEL', '리모델링', '인테리어', 'INTERIOR'],
  },

  // PLUMBING -> home-services/plumbing
  {
    category: 'home-services',
    subcategory: 'plumbing',
    keywords: ['배관', 'PLUMB', '플러밍', '플럼'],
  },

  // HVAC -> home-services/hvac
  {
    category: 'home-services',
    subcategory: 'hvac',
    keywords: ['냉난방', 'HVAC', 'AIR CONDITION', '에어컨', '냉동'],
  },

  // ELECTRICAL -> home-services/electrical
  {
    category: 'home-services',
    subcategory: 'electrical',
    keywords: ['전기', 'ELECTRIC', '일렉트릭'],
    excludeKeywords: ['전자', 'ELECTRONIC'],
  },

  // PAINTING -> home-services/painting
  {
    category: 'home-services',
    subcategory: 'painting',
    keywords: ['페인트', 'PAINT', '도장'],
  },

  // ROOFING -> home-services/roofing
  {
    category: 'home-services',
    subcategory: 'roofing',
    keywords: ['지붕', 'ROOF', '루핑'],
  },

  // CLEANING -> home-services/cleaning
  {
    category: 'home-services',
    subcategory: 'cleaning',
    keywords: ['청소', 'CLEAN', '크리닝', '카펫'],
  },

  // AUTO REPAIR -> auto/auto-repair
  {
    category: 'auto',
    subcategory: 'auto-repair',
    keywords: ['자동차수리', 'AUTO REPAIR', 'CAR REPAIR', '정비', '오토바디', 'AUTO BODY', 'BODY SHOP'],
  },

  // TOWING -> auto/towing
  {
    category: 'auto',
    subcategory: 'towing',
    keywords: ['토잉', 'TOWING', 'TOW SERVICE'],
  },

  // CAR DEALER -> auto/car-dealer
  {
    category: 'auto',
    subcategory: 'car-dealer',
    keywords: ['자동차매매', 'CAR DEALER', 'AUTO DEALER', 'AUTO SALES'],
  },

  // DENTAL -> dental
  {
    category: 'dental',
    keywords: ['치과', 'DENTAL', 'DENTIST', 'ORTHODONT', '교정'],
    excludeKeywords: ['치과기공'],
  },

  // MEDICAL -> medical
  {
    category: 'medical',
    keywords: ['병원', '의원', 'MEDICAL', 'CLINIC', 'DOCTOR', '내과', '외과', '안과', '이비인후과', '피부과', '소아과', '산부인과', '정형외과', '신경과', 'PHYSICIAN'],
    excludeKeywords: ['동물', 'ANIMAL', 'VET', 'PET'],
  },

  // PHARMACY -> medical/pharmacy
  {
    category: 'medical',
    subcategory: 'pharmacy',
    keywords: ['약국', 'PHARMACY', '파마씨'],
  },

  // KOREAN MEDICINE -> medical/korean-medicine
  {
    category: 'medical',
    subcategory: 'korean-medicine',
    keywords: ['한의원', '한방', 'ACUPUNCTURE', '침', '한의'],
  },

  // LEGAL -> legal
  {
    category: 'legal',
    keywords: ['법률', '변호사', 'LAW OFFICE', 'ATTORNEY', 'LAWYER', 'LEGAL'],
  },

  // NOTARY -> legal/notary
  {
    category: 'legal',
    subcategory: 'notary',
    keywords: ['공증', 'NOTARY'],
  },

  // INSURANCE -> insurance
  {
    category: 'insurance',
    keywords: ['보험', 'INSURANCE'],
  },

  // REAL ESTATE -> real-estate
  {
    category: 'real-estate',
    keywords: ['부동산', 'REAL ESTATE', 'REALTY', 'REALTOR', '공인중개'],
    excludeKeywords: ['여행', 'TRAVEL', 'TOUR', '열쇠', 'LOCKSMITH'],
  },

  // ESCROW -> real-estate/escrow
  {
    category: 'real-estate',
    subcategory: 'escrow',
    keywords: ['에스크로', 'ESCROW', 'TITLE'],
    excludeKeywords: ['여행', 'TRAVEL', 'TOUR', '열쇠', 'LOCKSMITH'],
  },

  // CPA -> financial/cpa
  {
    category: 'financial',
    subcategory: 'cpa',
    keywords: ['회계사', 'CPA', 'ACCOUNTANT', '회계'],
  },

  // TAX -> financial/tax-preparer
  {
    category: 'financial',
    subcategory: 'tax-preparer',
    keywords: ['세무', 'TAX SERVICE', 'TAX PREP'],
  },

  // BANK -> financial/bank
  {
    category: 'financial',
    subcategory: 'bank',
    keywords: ['은행', 'BANK'],
  },

  // MORTGAGE -> financial/mortgage-broker
  {
    category: 'financial',
    subcategory: 'mortgage-broker',
    keywords: ['모기지', 'MORTGAGE', '융자', 'LOAN'],
  },

  // RESTAURANT -> food
  {
    category: 'food',
    keywords: ['식당', 'RESTAURANT', '음식점', 'BBQ', '바베큐', '고깃집', '삼겹살', '갈비', '불고기'],
  },

  // BAKERY -> food/bakery
  {
    category: 'food',
    subcategory: 'bakery',
    keywords: ['베이커리', 'BAKERY', '빵집', '제과', '떡집', '떡'],
  },

  // CAFE -> food/cafe
  {
    category: 'food',
    subcategory: 'cafe',
    keywords: ['카페', 'CAFE', 'COFFEE', '커피'],
  },

  // GROCERY -> food/grocery
  {
    category: 'food',
    subcategory: 'grocery',
    keywords: ['마켓', 'MARKET', '슈퍼', 'SUPER', '식품', 'GROCERY', '마트'],
  },

  // HAIR SALON -> beauty/hair-salon
  {
    category: 'beauty',
    subcategory: 'hair-salon',
    keywords: ['미용실', 'HAIR SALON', 'BEAUTY SALON', '헤어', 'HAIR'],
  },

  // SPA -> beauty/spa
  {
    category: 'beauty',
    subcategory: 'spa',
    keywords: ['스파', 'SPA', '사우나', 'SAUNA', '찜질'],
  },

  // SKIN CARE -> beauty/skin-care
  {
    category: 'beauty',
    subcategory: 'skin-care',
    keywords: ['스킨케어', 'SKIN CARE', '피부관리'],
  },

  // TUTORING -> education/tutoring
  {
    category: 'education',
    subcategory: 'tutoring',
    keywords: ['학원', '학습', 'ACADEMY', 'TUTORING', 'LEARNING', 'SAT', '과외'],
  },

  // DRIVING SCHOOL -> education/driving-school
  {
    category: 'education',
    subcategory: 'driving-school',
    keywords: ['운전학원', 'DRIVING SCHOOL', '드라이빙'],
  },

  // PRESCHOOL -> education/preschool
  {
    category: 'education',
    subcategory: 'preschool',
    keywords: ['유치원', 'PRESCHOOL', '어린이집', 'DAYCARE', 'CHILD CARE'],
  },

  // CHURCH -> community/church
  {
    category: 'community',
    subcategory: 'church',
    keywords: ['교회', 'CHURCH', '성당', 'CATHOLIC'],
  },

  // TEMPLE -> community/temple
  {
    category: 'community',
    subcategory: 'temple',
    keywords: ['절', '사찰', 'TEMPLE', 'BUDDHIST'],
  },

  // PRINTING -> professional/printing
  {
    category: 'professional',
    subcategory: 'printing',
    keywords: ['인쇄', 'PRINT', '프린팅'],
  },

  // PHOTOGRAPHY -> professional/photography
  {
    category: 'professional',
    subcategory: 'photography',
    keywords: ['사진', 'PHOTO', '스튜디오', 'STUDIO'],
    excludeKeywords: ['피부', 'SKIN'],
  },

  // SIGNAGE -> professional/signage
  {
    category: 'professional',
    subcategory: 'signage',
    keywords: ['간판', 'SIGN', '사인'],
  },

  // WEDDING -> professional/wedding
  {
    category: 'professional',
    subcategory: 'wedding',
    keywords: ['웨딩', 'WEDDING', '결혼'],
  },

  // FUNERAL -> professional/funeral
  {
    category: 'professional',
    subcategory: 'funeral',
    keywords: ['장례', 'FUNERAL', 'MORTUARY'],
  },

  // ELECTRONICS -> shopping/electronics
  {
    category: 'shopping',
    subcategory: 'electronics',
    keywords: ['전자', 'ELECTRONIC', '컴퓨터', 'COMPUTER'],
  },

  // FURNITURE -> shopping/furniture
  {
    category: 'shopping',
    subcategory: 'furniture',
    keywords: ['가구', 'FURNITURE'],
  },

  // JEWELRY -> shopping/jewelry
  {
    category: 'shopping',
    subcategory: 'jewelry',
    keywords: ['보석', 'JEWELRY', '금은방', '귀금속'],
  },

  // FLORIST -> shopping/florist
  {
    category: 'shopping',
    subcategory: 'florist',
    keywords: ['꽃집', 'FLOWER', 'FLORIST', '플라워'],
  },

  // OPTICAL -> shopping/optical
  {
    category: 'shopping',
    subcategory: 'optical',
    keywords: ['안경', 'OPTICAL', 'EYEGLASS', '아이글라스'],
    excludeKeywords: ['안과'],
  },
];

function detectCategory(nameKo: string, nameEn: string | null): { category: string; subcategory?: string } | null {
  const combinedName = `${nameKo} ${nameEn || ''}`.toUpperCase();

  for (const pattern of CATEGORY_PATTERNS) {
    // Check if any keyword matches
    const hasKeyword = pattern.keywords.some(keyword =>
      combinedName.includes(keyword.toUpperCase())
    );

    if (!hasKeyword) continue;

    // Check exclude keywords
    if (pattern.excludeKeywords) {
      const hasExclude = pattern.excludeKeywords.some(keyword =>
        combinedName.includes(keyword.toUpperCase())
      );
      if (hasExclude) continue;
    }

    return {
      category: pattern.category,
      subcategory: pattern.subcategory,
    };
  }

  return null;
}

async function fixAllCategories() {
  console.log('Starting comprehensive category fix...\n');

  // Get all category IDs
  const categories = await prisma.category.findMany();
  const categoryMap = new Map(categories.map(c => [c.slug, c.id]));

  console.log(`Loaded ${categories.length} categories\n`);

  // Get all businesses
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      primaryCategoryId: true,
      subcategoryId: true,
      primaryCategory: { select: { slug: true, nameKo: true } },
    }
  });

  console.log(`Processing ${businesses.length} businesses...\n`);

  const fixes: Map<string, { from: string; to: string; count: number; examples: string[] }> = new Map();
  let totalFixed = 0;

  for (const biz of businesses) {
    const detected = detectCategory(biz.nameKo, biz.nameEn);

    if (!detected) continue;

    const newPrimaryCategoryId = categoryMap.get(detected.category);
    const newSubcategoryId = detected.subcategory ? categoryMap.get(detected.subcategory) : null;

    if (!newPrimaryCategoryId) continue;

    // Check if category needs to change
    if (biz.primaryCategoryId === newPrimaryCategoryId) continue;

    const fromCategory = biz.primaryCategory?.nameKo || 'unknown';
    const toCategory = detected.category;
    const key = `${fromCategory} -> ${toCategory}`;

    // Update business
    await prisma.business.update({
      where: { id: biz.id },
      data: {
        primaryCategoryId: newPrimaryCategoryId,
        subcategoryId: newSubcategoryId,
      }
    });

    totalFixed++;

    // Track fixes
    if (!fixes.has(key)) {
      fixes.set(key, { from: fromCategory, to: toCategory, count: 0, examples: [] });
    }
    const fix = fixes.get(key)!;
    fix.count++;
    if (fix.examples.length < 3) {
      fix.examples.push(`${biz.nameKo} | ${biz.nameEn}`);
    }
  }

  // Print summary
  console.log('\n=== Category Fix Summary ===\n');

  const sortedFixes = Array.from(fixes.entries()).sort((a, b) => b[1].count - a[1].count);

  for (const [key, fix] of sortedFixes) {
    console.log(`${key}: ${fix.count} businesses`);
    fix.examples.forEach(ex => console.log(`  - ${ex}`));
    console.log('');
  }

  console.log(`\nTotal businesses re-categorized: ${totalFixed}`);

  // Print current category counts
  console.log('\n=== Current Category Counts ===\n');

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
    await fixAllCategories();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
