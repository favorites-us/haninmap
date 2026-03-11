/**
 * Comprehensive subcategory fix based on business name patterns
 * Run with: npx tsx scripts/fix-all-subcategories.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Subcategory detection patterns
// Format: [keywords, subcategory_slug, parent_primary_slug]
const SUBCATEGORY_PATTERNS: Array<{
  keywords: string[];
  subcategory: string;
  primary: string;
  excludeKeywords?: string[];
}> = [
  // === MEDICAL SUBCATEGORIES ===
  // Internal Medicine
  { keywords: ['내과', 'INTERNAL MEDICINE', '가정의', 'FAMILY MEDICINE', 'FAMILY PRACTICE', '가정주치의'], subcategory: 'internal-medicine', primary: 'medical' },

  // OBGYN
  { keywords: ['산부인과', 'OBGYN', 'OB-GYN', 'OB/GYN', 'OBSTETRIC', 'GYNECOLOG'], subcategory: 'obgyn', primary: 'medical' },

  // Pediatrics
  { keywords: ['소아과', 'PEDIATRIC', '소아청소년과', 'CHILDREN'], subcategory: 'pediatrics', primary: 'medical', excludeKeywords: ['치과', 'DENTAL', 'DENTIST'] },

  // Dermatology
  { keywords: ['피부과', 'DERMATOL', '피부', 'SKIN DOCTOR'], subcategory: 'dermatology', primary: 'medical', excludeKeywords: ['스킨케어', 'SKIN CARE', '피부관리'] },

  // Ophthalmology
  { keywords: ['안과', 'OPHTHALM', 'EYE PHYSICIAN', 'EYE SURGEON', 'EYE SURGERY', '눈수술'], subcategory: 'ophthalmology', primary: 'medical', excludeKeywords: ['검안', 'OPTOM', '안경'] },

  // ENT
  { keywords: ['이비인후과', 'ENT', 'EAR NOSE THROAT', 'OTOLARYN'], subcategory: 'ent', primary: 'medical' },

  // Orthopedics
  { keywords: ['정형외과', 'ORTHOPED', 'ORTHOPEDIC'], subcategory: 'orthopedics', primary: 'medical' },

  // Neurosurgery
  { keywords: ['신경외과', 'NEUROSURG'], subcategory: 'neurosurgery', primary: 'medical' },

  // Urology
  { keywords: ['비뇨기과', 'UROLOG'], subcategory: 'urology', primary: 'medical' },

  // Cardiology
  { keywords: ['심장내과', 'CARDIOL', '심장', 'HEART'], subcategory: 'cardiology', primary: 'medical', excludeKeywords: ['심장사상충', 'PET'] },

  // Gastroenterology
  { keywords: ['소화기내과', 'GASTROENTER', '위장내과', '위장', 'STOMACH'], subcategory: 'gastroenterology', primary: 'medical' },

  // Psychiatry
  { keywords: ['정신과', 'PSYCHIATR', '정신건강', 'MENTAL HEALTH'], subcategory: 'psychiatry', primary: 'medical' },

  // Plastic Surgery
  { keywords: ['성형외과', 'PLASTIC SURG', 'COSMETIC SURG'], subcategory: 'plastic-surgery', primary: 'medical' },

  // Pain Management / Chiropractic
  { keywords: ['통증', 'PAIN', '척추신경', 'CHIROPRACTIC', '카이로프랙틱'], subcategory: 'pain-management', primary: 'medical' },

  // Rehabilitation
  { keywords: ['재활', 'REHABIL', '물리치료', 'PHYSICAL THERAPY'], subcategory: 'rehabilitation', primary: 'medical' },

  // General Surgery
  { keywords: ['일반외과', 'GENERAL SURG'], subcategory: 'general-surgery', primary: 'medical', excludeKeywords: ['성형', 'PLASTIC', '신경', 'NEURO'] },

  // Oncology
  { keywords: ['종양', 'ONCOLOG', '암센터', 'CANCER CENTER'], subcategory: 'oncology', primary: 'medical' },

  // Nephrology
  { keywords: ['신장내과', 'NEPHROL', 'KIDNEY'], subcategory: 'nephrology', primary: 'medical' },

  // Pulmonology
  { keywords: ['호흡기내과', 'PULMONOL', '폐', 'LUNG'], subcategory: 'pulmonology', primary: 'medical' },

  // Endocrinology
  { keywords: ['내분비', 'ENDOCRIN', '당뇨', 'DIABETES'], subcategory: 'endocrinology', primary: 'medical' },

  // Rheumatology
  { keywords: ['류마티스', 'RHEUMATOL'], subcategory: 'rheumatology', primary: 'medical' },

  // Allergy
  { keywords: ['알레르기', 'ALLERG'], subcategory: 'allergy', primary: 'medical' },

  // Podiatry
  { keywords: ['발', 'PODIATR', 'FOOT', 'D.P.M'], subcategory: 'podiatry', primary: 'medical', excludeKeywords: ['발레', 'BALLET'] },

  // Korean Medicine
  { keywords: ['한의원', '한방', 'ACUPUNCTURE', '침', '한의'], subcategory: 'korean-medicine', primary: 'medical' },

  // Pharmacy
  { keywords: ['약국', 'PHARMACY', '파마씨'], subcategory: 'pharmacy', primary: 'medical' },

  // === DENTAL SUBCATEGORIES ===
  // General Dentist
  { keywords: ['치과', 'DENTAL', 'DENTIST'], subcategory: 'general-dentist', primary: 'dental', excludeKeywords: ['교정', 'ORTHO', '소아', 'PEDIATRIC', '임플란트', 'IMPLANT'] },

  // Orthodontist
  { keywords: ['교정', 'ORTHODON'], subcategory: 'orthodontist', primary: 'dental' },

  // Pediatric Dentist
  { keywords: ['소아치과', 'PEDIATRIC DENT', 'CHILDREN DENT'], subcategory: 'pediatric-dentist', primary: 'dental' },

  // Dental Implants
  { keywords: ['임플란트', 'IMPLANT'], subcategory: 'dental-implants', primary: 'dental' },

  // === LEGAL SUBCATEGORIES ===
  // Immigration Lawyer
  { keywords: ['이민법', 'IMMIGRATION'], subcategory: 'immigration-lawyer', primary: 'legal' },

  // Personal Injury
  { keywords: ['상해', 'PERSONAL INJURY', 'INJURY'], subcategory: 'personal-injury-lawyer', primary: 'legal' },

  // Notary
  { keywords: ['공증', 'NOTARY'], subcategory: 'notary', primary: 'legal' },

  // === FINANCIAL SUBCATEGORIES ===
  // CPA
  { keywords: ['회계사', 'CPA', 'ACCOUNTANT'], subcategory: 'cpa', primary: 'financial' },

  // Tax Preparer
  { keywords: ['세무', 'TAX'], subcategory: 'tax-preparer', primary: 'financial' },

  // Mortgage
  { keywords: ['모기지', 'MORTGAGE', '융자', 'LOAN'], subcategory: 'mortgage-broker', primary: 'financial' },

  // Bank
  { keywords: ['은행', 'BANK'], subcategory: 'bank', primary: 'financial' },

  // === FOOD SUBCATEGORIES ===
  // Korean BBQ
  { keywords: ['BBQ', '바베큐', '고깃집', '삼겹살', '갈비', '불고기', '숯불', '화로'], subcategory: 'korean-bbq', primary: 'food' },

  // Korean Restaurant
  { keywords: ['한식', '한정식', 'KOREAN RESTAURANT', 'KOREAN FOOD', '국밥', '설렁탕', '순두부', '찌개', '비빔밥', '냉면'], subcategory: 'korean-restaurant', primary: 'food' },

  // Japanese Restaurant
  { keywords: ['일식', '스시', 'SUSHI', '라멘', 'RAMEN', '일본', 'JAPANESE', '우동', 'UDON', '덴푸라', 'IZAKAYA'], subcategory: 'japanese-restaurant', primary: 'food', excludeKeywords: ['카페', 'CAFE', 'COFFEE', '커피'] },

  // Chinese Restaurant
  { keywords: ['중식', '중국', 'CHINESE', '짜장', '짬뽕', '딤섬', 'DIM SUM'], subcategory: 'chinese-restaurant', primary: 'food' },

  // Western Restaurant
  { keywords: ['양식', '스테이크', 'STEAK', '이탈리안', 'ITALIAN', '파스타', 'PASTA', '피자', 'PIZZA', 'BURGER', '버거'], subcategory: 'western-restaurant', primary: 'food' },

  // Snack Bar
  { keywords: ['분식', '떡볶이', '김밥', '라면', '튀김'], subcategory: 'snack-bar', primary: 'food' },

  // Bakery
  { keywords: ['베이커리', 'BAKERY', '빵집', '제과', '떡집', '떡', '케이크', 'CAKE'], subcategory: 'bakery', primary: 'food' },

  // Cafe
  { keywords: ['카페', 'CAFE', 'COFFEE', '커피', '티하우스', 'TEA HOUSE', '디저트', 'DESSERT'], subcategory: 'cafe', primary: 'food' },

  // Grocery
  { keywords: ['마켓', 'MARKET', '슈퍼', 'SUPER', '식품', 'GROCERY', '마트'], subcategory: 'grocery', primary: 'food' },

  // === BEAUTY SUBCATEGORIES ===
  // Hair Salon
  { keywords: ['미용실', 'HAIR SALON', 'BEAUTY SALON', '헤어'], subcategory: 'hair-salon', primary: 'beauty' },

  // Barbershop
  { keywords: ['이발', 'BARBER'], subcategory: 'barbershop', primary: 'beauty' },

  // Skin Care
  { keywords: ['스킨케어', 'SKIN CARE', '피부관리', '에스테틱', 'ESTHETIC'], subcategory: 'skin-care', primary: 'beauty' },

  // Spa
  { keywords: ['스파', 'SPA', '사우나', 'SAUNA', '찜질'], subcategory: 'spa', primary: 'beauty' },

  // Nail Salon
  { keywords: ['네일', 'NAIL'], subcategory: 'nail-salon', primary: 'beauty' },

  // === AUTO SUBCATEGORIES ===
  // Auto Repair
  { keywords: ['자동차수리', 'AUTO REPAIR', 'CAR REPAIR', '정비', 'AUTO SERVICE', 'AUTO CENTER'], subcategory: 'auto-repair', primary: 'auto' },

  // Body Shop
  { keywords: ['바디샵', 'BODY SHOP', 'AUTO BODY', '판금', '도색'], subcategory: 'body-shop', primary: 'auto' },

  // Car Dealer
  { keywords: ['자동차매매', 'CAR DEALER', 'AUTO DEALER', 'AUTO SALES'], subcategory: 'car-dealer', primary: 'auto' },

  // Car Wash
  { keywords: ['세차', 'CAR WASH'], subcategory: 'car-wash', primary: 'auto' },

  // Tires
  { keywords: ['타이어', 'TIRE'], subcategory: 'tires', primary: 'auto' },

  // Towing
  { keywords: ['토잉', 'TOWING', 'TOW'], subcategory: 'towing', primary: 'auto' },

  // === HOME SERVICES SUBCATEGORIES ===
  // Plumbing
  { keywords: ['배관', 'PLUMB'], subcategory: 'plumbing', primary: 'home-services' },

  // HVAC
  { keywords: ['냉난방', 'HVAC', 'AIR CONDITION', '에어컨'], subcategory: 'hvac', primary: 'home-services' },

  // Roofing
  { keywords: ['지붕', 'ROOF'], subcategory: 'roofing', primary: 'home-services' },

  // Cleaning
  { keywords: ['청소', 'CLEAN', '크리닝'], subcategory: 'cleaning', primary: 'home-services' },

  // Electrical
  { keywords: ['전기', 'ELECTRIC'], subcategory: 'electrical', primary: 'home-services', excludeKeywords: ['전자', 'ELECTRONIC'] },

  // Landscaping
  { keywords: ['조경', 'LANDSCAPE', '정원', 'GARDEN'], subcategory: 'landscaping', primary: 'home-services', excludeKeywords: ['가든그로브', 'GARDEN GROVE'] },

  // Moving
  { keywords: ['이삿짐', '이사', 'MOVING', 'MOVER'], subcategory: 'moving', primary: 'home-services' },

  // Construction
  { keywords: ['건축', '건설', 'CONSTRUCTION', 'CONTRACTOR', 'REMODEL', '리모델링'], subcategory: 'construction', primary: 'home-services' },

  // Painting
  { keywords: ['페인트', 'PAINT', '도장'], subcategory: 'painting', primary: 'home-services' },

  // Locksmith
  { keywords: ['열쇠', 'LOCKSMITH', 'LOCK'], subcategory: 'locksmith', primary: 'home-services' },

  // === EDUCATION SUBCATEGORIES ===
  // Tutoring
  { keywords: ['학원', '학습', 'ACADEMY', 'TUTORING', 'LEARNING', 'SAT', '과외', '학교'], subcategory: 'tutoring', primary: 'education', excludeKeywords: ['운전', 'DRIVING', '태권도', 'TAEKWONDO', '댄스', 'DANCE', '음악', 'MUSIC', '피아노', 'PIANO'] },

  // Driving School
  { keywords: ['운전학원', 'DRIVING SCHOOL', '드라이빙'], subcategory: 'driving-school', primary: 'education' },

  // Preschool
  { keywords: ['유치원', 'PRESCHOOL', '어린이집', 'DAYCARE', 'CHILD CARE'], subcategory: 'preschool', primary: 'education' },

  // Music School
  { keywords: ['음악학원', 'MUSIC SCHOOL', '피아노', 'PIANO', '바이올린', 'VIOLIN'], subcategory: 'music-school', primary: 'education' },

  // Martial Arts
  { keywords: ['태권도', 'TAEKWONDO', '합기도', 'HAPKIDO', '무술', 'MARTIAL'], subcategory: 'martial-arts', primary: 'education' },

  // Dance School
  { keywords: ['댄스', 'DANCE'], subcategory: 'dance-school', primary: 'education' },

  // === TRAVEL SUBCATEGORIES ===
  // Travel Agency
  { keywords: ['여행사', 'TRAVEL', 'TOUR'], subcategory: 'travel-agency', primary: 'travel' },

  // Airline
  { keywords: ['항공', 'AIRLINE', 'AIR LINE'], subcategory: 'airline', primary: 'travel' },

  // Hotel
  { keywords: ['호텔', 'HOTEL', '모텔', 'MOTEL', '리조트', 'RESORT'], subcategory: 'hotel', primary: 'travel' },

  // === PROFESSIONAL SUBCATEGORIES ===
  // Printing
  { keywords: ['인쇄', 'PRINT'], subcategory: 'printing', primary: 'professional' },

  // Photography
  { keywords: ['사진', 'PHOTO', '스튜디오', 'STUDIO'], subcategory: 'photography', primary: 'professional', excludeKeywords: ['피부', 'SKIN', '댄스', 'DANCE', '음악', 'MUSIC'] },

  // Signage
  { keywords: ['간판', 'SIGN'], subcategory: 'signage', primary: 'professional' },

  // Wedding
  { keywords: ['웨딩', 'WEDDING', '결혼'], subcategory: 'wedding', primary: 'professional' },

  // Funeral
  { keywords: ['장례', 'FUNERAL', 'MORTUARY'], subcategory: 'funeral', primary: 'professional' },

  // === SHOPPING SUBCATEGORIES ===
  // Electronics
  { keywords: ['전자', 'ELECTRONIC', '컴퓨터', 'COMPUTER'], subcategory: 'electronics', primary: 'shopping' },

  // Furniture
  { keywords: ['가구', 'FURNITURE'], subcategory: 'furniture', primary: 'shopping' },

  // Jewelry
  { keywords: ['보석', 'JEWELRY', '금은방', '귀금속'], subcategory: 'jewelry', primary: 'shopping' },

  // Florist
  { keywords: ['꽃집', 'FLOWER', 'FLORIST', '플라워'], subcategory: 'florist', primary: 'shopping' },

  // Optical
  { keywords: ['안경', 'OPTICAL', 'EYEGLASS', '검안'], subcategory: 'optical', primary: 'shopping' },

  // === COMMUNITY SUBCATEGORIES ===
  // Church
  { keywords: ['교회', 'CHURCH', '성당', 'CATHOLIC'], subcategory: 'church', primary: 'community' },

  // Temple
  { keywords: ['절', '사찰', 'TEMPLE', 'BUDDHIST'], subcategory: 'temple', primary: 'community' },
];

function detectSubcategory(nameKo: string, nameEn: string | null, currentPrimary: string): { subcategory: string; primary: string } | null {
  const combinedName = `${nameKo} ${nameEn || ''}`.toUpperCase();

  for (const pattern of SUBCATEGORY_PATTERNS) {
    // Only match subcategories that belong to the current primary category
    if (pattern.primary !== currentPrimary) continue;

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
      subcategory: pattern.subcategory,
      primary: pattern.primary,
    };
  }

  return null;
}

async function fixAllSubcategories() {
  console.log('Starting comprehensive subcategory fix...\n');

  // Get all category IDs
  const categories = await prisma.category.findMany({
    include: { parent: true }
  });
  const categoryMap = new Map(categories.map(c => [c.slug, c.id]));
  const categoryById = new Map(categories.map(c => [c.id, c]));

  console.log(`Loaded ${categories.length} categories\n`);

  // First, clear all subcategory assignments
  console.log('Clearing all subcategory assignments...');
  await prisma.business.updateMany({
    data: { subcategoryId: null }
  });
  console.log('Done.\n');

  // Get all businesses with their primary category
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      primaryCategoryId: true,
    }
  });

  console.log(`Processing ${businesses.length} businesses...\n`);

  const subcategoryStats: Map<string, number> = new Map();
  let assigned = 0;

  for (const biz of businesses) {
    const primaryCategory = categoryById.get(biz.primaryCategoryId);
    if (!primaryCategory) continue;

    const detected = detectSubcategory(biz.nameKo, biz.nameEn, primaryCategory.slug);

    if (!detected) continue;

    const subcategoryId = categoryMap.get(detected.subcategory);
    if (!subcategoryId) continue;

    // Update business
    await prisma.business.update({
      where: { id: biz.id },
      data: { subcategoryId }
    });

    assigned++;
    const key = `${primaryCategory.slug}/${detected.subcategory}`;
    subcategoryStats.set(key, (subcategoryStats.get(key) || 0) + 1);
  }

  // Print summary
  console.log('\n=== Subcategory Assignment Summary ===\n');

  const sortedStats = Array.from(subcategoryStats.entries()).sort((a, b) => b[1] - a[1]);

  for (const [key, count] of sortedStats) {
    console.log(`${key}: ${count}`);
  }

  console.log(`\nTotal businesses with subcategory: ${assigned}`);
  console.log(`Businesses without subcategory: ${businesses.length - assigned}`);
}

async function main() {
  try {
    await fixAllSubcategories();
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
