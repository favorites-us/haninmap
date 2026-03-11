/**
 * Fix Remaining NULL Subcategories (26.5% → ~16%)
 *
 * Phase 0: Before snapshot
 * Phase 1: RadioKorea mapping updates (UID-based, sub added to T02/H04/C01/S09/A23/C04)
 * Phase 2: KoreaDaily SKIP item mapping (including cross-category fixes)
 * Phase 3: Name-based pattern matching (NULL only, 30+ new patterns)
 * Phase 4: After snapshot + report
 *
 * IMPORTANT: Only touches businesses with subcategoryId IS NULL.
 *
 * Run: npx tsx scripts/fix-remaining-nulls.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import {
  KOREADAILY_SUB_MAPPING,
  KOREADAILY_CROSS_CATEGORY_FIXES,
  mapRadioKoreaCategory,
} from '../../src/lib/taxonomy/categoryMapping';

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

const BATCH_SIZE = 100;

// ────────────────────────────────────────────
// New subcategories to ensure exist in DB
// ────────────────────────────────────────────
const NEW_SUBCATEGORIES = [
  { slug: 'fitness', nameKo: '헬스/피트니스', nameEn: 'Fitness', parent: 'community' },
];

// ────────────────────────────────────────────
// Name-based pattern matching for Phase 3
// These supplement the existing patterns from fix-all-subcategories.ts
// Only applied to businesses with subcategoryId IS NULL
// ────────────────────────────────────────────
const ADDITIONAL_PATTERNS: Array<{
  keywords: string[];
  subcategory: string;
  primary: string;
  excludeKeywords?: string[];
}> = [
  // === INSURANCE (기존 패턴 없음) ===
  { keywords: ['생명보험', 'LIFE INS', 'LIFE INSURANCE'], subcategory: 'life-insurance', primary: 'insurance' },
  { keywords: ['자동차보험', 'AUTO INS', 'AUTO INSURANCE', 'CAR INSURANCE'], subcategory: 'auto-insurance', primary: 'insurance' },
  { keywords: ['건강보험', 'HEALTH INS', 'HEALTH INSURANCE'], subcategory: 'health-insurance', primary: 'insurance' },
  { keywords: ['보험', 'INSURANCE'], subcategory: 'business-insurance', primary: 'insurance' },

  // === REAL ESTATE (기존 패턴 없음) ===
  { keywords: ['에스크로', 'ESCROW'], subcategory: 'escrow', primary: 'real-estate' },
  { keywords: ['부동산', 'REAL ESTATE', 'REALTOR', 'REALTY'], subcategory: 'residential-realtor', primary: 'real-estate' },

  // === LEGAL 강화 ===
  { keywords: ['이민', 'IMMIGRATION'], subcategory: 'immigration-lawyer', primary: 'legal' },
  { keywords: ['가정법', 'FAMILY LAW', 'DIVORCE', '이혼'], subcategory: 'family-lawyer', primary: 'legal' },
  { keywords: ['형사', 'CRIMINAL', 'DUI', 'DWI'], subcategory: 'criminal-lawyer', primary: 'legal' },
  { keywords: ['변호사', 'ATTORNEY', 'LAW OFFICE', 'LAW FIRM', 'LAWYER', 'ESQ'], subcategory: 'business-lawyer', primary: 'legal' },

  // === AUTO 강화 ===
  { keywords: ['렌터카', '렌트카', 'RENT A CAR', 'CAR RENTAL', 'RENTAL CAR'], subcategory: 'car-rental', primary: 'auto' },
  { keywords: ['택시', 'TAXI', 'LIMO', '리무진', 'LIMOUSINE', '대리운전'], subcategory: 'taxi', primary: 'auto' },

  // === HOME SERVICES 강화 ===
  { keywords: ['세탁', 'LAUNDRY', 'DRY CLEAN', '드라이클리닝', '클리너스', 'CLEANERS'], subcategory: 'laundry', primary: 'home-services', excludeKeywords: ['카펫', 'CARPET'] },
  { keywords: ['택배', 'SHIPPING', 'COURIER', '배송', '화물', 'FREIGHT', 'CARGO'], subcategory: 'shipping', primary: 'home-services' },
  { keywords: ['핸디맨', 'HANDYMAN', '목수', 'CARPENTER', '집수리'], subcategory: 'handyman', primary: 'home-services' },
  { keywords: ['차고문', 'GARAGE DOOR'], subcategory: 'construction', primary: 'home-services' },
  { keywords: ['유리', 'GLASS', '창문', 'WINDOW'], subcategory: 'construction', primary: 'home-services', excludeKeywords: ['안경', 'OPTICAL', '자동차'] },
  { keywords: ['철공', 'WELDING', '용접', 'IRON WORK'], subcategory: 'construction', primary: 'home-services' },
  { keywords: ['인테리어', 'INTERIOR', '실내장식', '리모델링', 'REMODEL'], subcategory: 'construction', primary: 'home-services' },
  { keywords: ['도배', 'WALLPAPER'], subcategory: 'painting', primary: 'home-services' },

  // === SHOPPING 강화 ===
  { keywords: ['의류', 'CLOTHING', '옷', 'FASHION', 'APPAREL', '양복', '양장'], subcategory: 'clothing', primary: 'shopping' },
  { keywords: ['서점', 'BOOKSTORE', 'BOOK STORE', '책'], subcategory: 'bookstore', primary: 'shopping', excludeKeywords: ['카페', 'CAFE'] },
  { keywords: ['핸드폰', '휴대폰', 'CELL PHONE', 'CELLPHONE', 'MOBILE', 'T-MOBILE', 'WIRELESS'], subcategory: 'electronics', primary: 'shopping' },

  // === COMMUNITY 강화 ===
  { keywords: ['신문', '방송', 'TV', 'RADIO', 'NEWSPAPER', '미디어', 'MEDIA', '뉴스', 'NEWS'], subcategory: 'media', primary: 'community', excludeKeywords: ['교회', 'CHURCH'] },
  { keywords: ['헬스', '피트니스', 'FITNESS', 'GYM', 'WORKOUT'], subcategory: 'fitness', primary: 'community', excludeKeywords: ['스파', 'SPA'] },
  { keywords: ['동창회', '동문회', '향우회', '동호회', 'ASSOCIATION', 'ALUMNI'], subcategory: 'organization', primary: 'community', excludeKeywords: ['교회', 'CHURCH'] },

  // === PROFESSIONAL 강화 ===
  { keywords: ['번역', 'TRANSLATION', 'INTERPRETER', '통역'], subcategory: 'translation', primary: 'professional' },
  { keywords: ['광고', 'ADVERTISING', 'AD AGENCY', '마케팅', 'MARKETING'], subcategory: 'advertising', primary: 'professional' },

  // === FOOD 강화 ===
  { keywords: ['치킨', 'CHICKEN', 'FRIED CHICKEN'], subcategory: 'chicken-pizza', primary: 'food', excludeKeywords: ['한식', 'KOREAN RESTAURANT'] },
  { keywords: ['노래방', '가라오케', 'KARAOKE', 'BAR', '주점', '술집', '바', 'LOUNGE', 'PUB'], subcategory: 'nightlife', primary: 'food', excludeKeywords: ['BAR-B-Q', 'BBQ', 'BARBECUE'] },
  { keywords: ['리커', 'LIQUOR', '리커스토어'], subcategory: 'grocery', primary: 'food' },
  { keywords: ['도넛', 'DONUT', 'DOUGHNUT'], subcategory: 'bakery', primary: 'food' },
  { keywords: ['분식', '떡볶이', '김밥', 'SNACK'], subcategory: 'snack-bar', primary: 'food', excludeKeywords: ['마켓', 'MARKET'] },

  // === BEAUTY 강화 ===
  { keywords: ['화장품', 'COSMETICS', 'COSMETIC'], subcategory: 'cosmetics', primary: 'beauty' },
  { keywords: ['네일', 'NAIL'], subcategory: 'nail-salon', primary: 'beauty' },

  // === FINANCIAL 강화 ===
  { keywords: ['송금', 'REMITTANCE', 'MONEY TRANSFER', 'WIRE TRANSFER'], subcategory: 'bank', primary: 'financial' },
  { keywords: ['재정', 'FINANCIAL ADVISOR', 'FINANCIAL PLANNING', '투자', 'INVESTMENT'], subcategory: 'financial-advisor', primary: 'financial' },
];

// Combine with existing patterns from fix-all-subcategories.ts
const EXISTING_PATTERNS: Array<{
  keywords: string[];
  subcategory: string;
  primary: string;
  excludeKeywords?: string[];
}> = [
  // === MEDICAL ===
  { keywords: ['내과', 'INTERNAL MEDICINE', '가정의', 'FAMILY MEDICINE', 'FAMILY PRACTICE', '가정주치의'], subcategory: 'internal-medicine', primary: 'medical' },
  { keywords: ['산부인과', 'OBGYN', 'OB-GYN', 'OB/GYN', 'OBSTETRIC', 'GYNECOLOG'], subcategory: 'obgyn', primary: 'medical' },
  { keywords: ['소아과', 'PEDIATRIC', '소아청소년과', 'CHILDREN'], subcategory: 'pediatrics', primary: 'medical', excludeKeywords: ['치과', 'DENTAL', 'DENTIST'] },
  { keywords: ['피부과', 'DERMATOL', '피부', 'SKIN DOCTOR'], subcategory: 'dermatology', primary: 'medical', excludeKeywords: ['스킨케어', 'SKIN CARE', '피부관리'] },
  { keywords: ['안과', 'OPHTHALM', 'EYE PHYSICIAN', 'EYE SURGEON', 'EYE SURGERY', '눈수술'], subcategory: 'ophthalmology', primary: 'medical', excludeKeywords: ['검안', 'OPTOM', '안경'] },
  { keywords: ['이비인후과', 'ENT', 'EAR NOSE THROAT', 'OTOLARYN'], subcategory: 'ent', primary: 'medical' },
  { keywords: ['정형외과', 'ORTHOPED', 'ORTHOPEDIC'], subcategory: 'orthopedics', primary: 'medical' },
  { keywords: ['신경외과', 'NEUROSURG'], subcategory: 'neurosurgery', primary: 'medical' },
  { keywords: ['비뇨기과', 'UROLOG'], subcategory: 'urology', primary: 'medical' },
  { keywords: ['심장내과', 'CARDIOL', '심장', 'HEART'], subcategory: 'cardiology', primary: 'medical', excludeKeywords: ['심장사상충', 'PET'] },
  { keywords: ['소화기내과', 'GASTROENTER', '위장내과', '위장', 'STOMACH'], subcategory: 'gastroenterology', primary: 'medical' },
  { keywords: ['정신과', 'PSYCHIATR', '정신건강', 'MENTAL HEALTH'], subcategory: 'psychiatry', primary: 'medical' },
  { keywords: ['성형외과', 'PLASTIC SURG', 'COSMETIC SURG'], subcategory: 'plastic-surgery', primary: 'medical' },
  { keywords: ['통증', 'PAIN', '척추신경', 'CHIROPRACTIC', '카이로프랙틱'], subcategory: 'pain-management', primary: 'medical' },
  { keywords: ['재활', 'REHABIL', '물리치료', 'PHYSICAL THERAPY'], subcategory: 'rehabilitation', primary: 'medical' },
  { keywords: ['일반외과', 'GENERAL SURG'], subcategory: 'general-surgery', primary: 'medical', excludeKeywords: ['성형', 'PLASTIC', '신경', 'NEURO'] },
  { keywords: ['종양', 'ONCOLOG', '암센터', 'CANCER CENTER'], subcategory: 'oncology', primary: 'medical' },
  { keywords: ['신장내과', 'NEPHROL', 'KIDNEY'], subcategory: 'nephrology', primary: 'medical' },
  { keywords: ['호흡기내과', 'PULMONOL', '폐', 'LUNG'], subcategory: 'pulmonology', primary: 'medical' },
  { keywords: ['내분비', 'ENDOCRIN', '당뇨', 'DIABETES'], subcategory: 'endocrinology', primary: 'medical' },
  { keywords: ['류마티스', 'RHEUMATOL'], subcategory: 'rheumatology', primary: 'medical' },
  { keywords: ['알레르기', 'ALLERG'], subcategory: 'allergy', primary: 'medical' },
  { keywords: ['발', 'PODIATR', 'FOOT', 'D.P.M'], subcategory: 'podiatry', primary: 'medical', excludeKeywords: ['발레', 'BALLET'] },
  { keywords: ['한의원', '한방', 'ACUPUNCTURE', '침', '한의'], subcategory: 'korean-medicine', primary: 'medical' },
  { keywords: ['약국', 'PHARMACY', '파마씨'], subcategory: 'pharmacy', primary: 'medical' },

  // === DENTAL ===
  { keywords: ['치과', 'DENTAL', 'DENTIST'], subcategory: 'general-dentist', primary: 'dental', excludeKeywords: ['교정', 'ORTHO', '소아', 'PEDIATRIC', '임플란트', 'IMPLANT'] },
  { keywords: ['교정', 'ORTHODON'], subcategory: 'orthodontist', primary: 'dental' },
  { keywords: ['소아치과', 'PEDIATRIC DENT', 'CHILDREN DENT'], subcategory: 'pediatric-dentist', primary: 'dental' },
  { keywords: ['임플란트', 'IMPLANT'], subcategory: 'dental-implants', primary: 'dental' },

  // === LEGAL ===
  { keywords: ['이민법', 'IMMIGRATION'], subcategory: 'immigration-lawyer', primary: 'legal' },
  { keywords: ['상해', 'PERSONAL INJURY', 'INJURY'], subcategory: 'personal-injury-lawyer', primary: 'legal' },
  { keywords: ['공증', 'NOTARY'], subcategory: 'notary', primary: 'legal' },

  // === FINANCIAL ===
  { keywords: ['회계사', 'CPA', 'ACCOUNTANT'], subcategory: 'cpa', primary: 'financial' },
  { keywords: ['세무', 'TAX'], subcategory: 'tax-preparer', primary: 'financial' },
  { keywords: ['모기지', 'MORTGAGE', '융자', 'LOAN'], subcategory: 'mortgage-broker', primary: 'financial' },
  { keywords: ['은행', 'BANK'], subcategory: 'bank', primary: 'financial' },

  // === FOOD ===
  { keywords: ['BBQ', '바베큐', '고깃집', '삼겹살', '갈비', '불고기', '숯불', '화로'], subcategory: 'korean-bbq', primary: 'food' },
  { keywords: ['한식', '한정식', 'KOREAN RESTAURANT', 'KOREAN FOOD', '국밥', '설렁탕', '순두부', '찌개', '비빔밥', '냉면'], subcategory: 'korean-restaurant', primary: 'food' },
  { keywords: ['일식', '스시', 'SUSHI', '라멘', 'RAMEN', '일본', 'JAPANESE', '우동', 'UDON', '덴푸라', 'IZAKAYA'], subcategory: 'japanese-restaurant', primary: 'food', excludeKeywords: ['카페', 'CAFE', 'COFFEE', '커피'] },
  { keywords: ['중식', '중국', 'CHINESE', '짜장', '짬뽕', '딤섬', 'DIM SUM'], subcategory: 'chinese-restaurant', primary: 'food' },
  { keywords: ['양식', '스테이크', 'STEAK', '이탈리안', 'ITALIAN', '파스타', 'PASTA', '피자', 'PIZZA', 'BURGER', '버거'], subcategory: 'western-restaurant', primary: 'food' },
  { keywords: ['분식', '떡볶이', '김밥', '라면', '튀김'], subcategory: 'snack-bar', primary: 'food' },
  { keywords: ['베이커리', 'BAKERY', '빵집', '제과', '떡집', '떡', '케이크', 'CAKE'], subcategory: 'bakery', primary: 'food' },
  { keywords: ['카페', 'CAFE', 'COFFEE', '커피', '티하우스', 'TEA HOUSE', '디저트', 'DESSERT'], subcategory: 'cafe', primary: 'food' },
  { keywords: ['마켓', 'MARKET', '슈퍼', 'SUPER', '식품', 'GROCERY', '마트'], subcategory: 'grocery', primary: 'food' },

  // === BEAUTY ===
  { keywords: ['미용실', 'HAIR SALON', 'BEAUTY SALON', '헤어'], subcategory: 'hair-salon', primary: 'beauty' },
  { keywords: ['이발', 'BARBER'], subcategory: 'barbershop', primary: 'beauty' },
  { keywords: ['스킨케어', 'SKIN CARE', '피부관리', '에스테틱', 'ESTHETIC'], subcategory: 'skin-care', primary: 'beauty' },
  { keywords: ['스파', 'SPA', '사우나', 'SAUNA', '찜질'], subcategory: 'spa', primary: 'beauty' },
  { keywords: ['네일', 'NAIL'], subcategory: 'nail-salon', primary: 'beauty' },

  // === AUTO ===
  { keywords: ['자동차수리', 'AUTO REPAIR', 'CAR REPAIR', '정비', 'AUTO SERVICE', 'AUTO CENTER'], subcategory: 'auto-repair', primary: 'auto' },
  { keywords: ['바디샵', 'BODY SHOP', 'AUTO BODY', '판금', '도색'], subcategory: 'body-shop', primary: 'auto' },
  { keywords: ['자동차매매', 'CAR DEALER', 'AUTO DEALER', 'AUTO SALES'], subcategory: 'car-dealer', primary: 'auto' },
  { keywords: ['세차', 'CAR WASH'], subcategory: 'car-wash', primary: 'auto' },
  { keywords: ['타이어', 'TIRE'], subcategory: 'tires', primary: 'auto' },
  { keywords: ['토잉', 'TOWING', 'TOW'], subcategory: 'towing', primary: 'auto' },

  // === HOME SERVICES ===
  { keywords: ['배관', 'PLUMB'], subcategory: 'plumbing', primary: 'home-services' },
  { keywords: ['냉난방', 'HVAC', 'AIR CONDITION', '에어컨'], subcategory: 'hvac', primary: 'home-services' },
  { keywords: ['지붕', 'ROOF'], subcategory: 'roofing', primary: 'home-services' },
  { keywords: ['청소', 'CLEAN', '크리닝'], subcategory: 'cleaning', primary: 'home-services', excludeKeywords: ['세탁', 'LAUNDRY', 'DRY CLEAN'] },
  { keywords: ['전기', 'ELECTRIC'], subcategory: 'electrical', primary: 'home-services', excludeKeywords: ['전자', 'ELECTRONIC'] },
  { keywords: ['조경', 'LANDSCAPE', '정원', 'GARDEN'], subcategory: 'landscaping', primary: 'home-services', excludeKeywords: ['가든그로브', 'GARDEN GROVE'] },
  { keywords: ['이삿짐', '이사', 'MOVING', 'MOVER'], subcategory: 'moving', primary: 'home-services' },
  { keywords: ['건축', '건설', 'CONSTRUCTION', 'CONTRACTOR', 'REMODEL', '리모델링'], subcategory: 'construction', primary: 'home-services' },
  { keywords: ['페인트', 'PAINT', '도장'], subcategory: 'painting', primary: 'home-services' },
  { keywords: ['열쇠', 'LOCKSMITH', 'LOCK'], subcategory: 'locksmith', primary: 'home-services' },

  // === EDUCATION ===
  { keywords: ['학원', '학습', 'ACADEMY', 'TUTORING', 'LEARNING', 'SAT', '과외', '학교'], subcategory: 'tutoring', primary: 'education', excludeKeywords: ['운전', 'DRIVING', '태권도', 'TAEKWONDO', '댄스', 'DANCE', '음악', 'MUSIC', '피아노', 'PIANO'] },
  { keywords: ['운전학원', 'DRIVING SCHOOL', '드라이빙'], subcategory: 'driving-school', primary: 'education' },
  { keywords: ['유치원', 'PRESCHOOL', '어린이집', 'DAYCARE', 'CHILD CARE'], subcategory: 'preschool', primary: 'education' },
  { keywords: ['음악학원', 'MUSIC SCHOOL', '피아노', 'PIANO', '바이올린', 'VIOLIN'], subcategory: 'music-school', primary: 'education' },
  { keywords: ['태권도', 'TAEKWONDO', '합기도', 'HAPKIDO', '무술', 'MARTIAL'], subcategory: 'martial-arts', primary: 'education' },
  { keywords: ['댄스', 'DANCE'], subcategory: 'dance-school', primary: 'education' },

  // === TRAVEL ===
  { keywords: ['여행사', 'TRAVEL', 'TOUR'], subcategory: 'travel-agency', primary: 'travel' },
  { keywords: ['항공', 'AIRLINE', 'AIR LINE'], subcategory: 'airline', primary: 'travel' },
  { keywords: ['호텔', 'HOTEL', '모텔', 'MOTEL', '리조트', 'RESORT'], subcategory: 'hotel', primary: 'travel' },

  // === PROFESSIONAL ===
  { keywords: ['인쇄', 'PRINT'], subcategory: 'printing', primary: 'professional' },
  { keywords: ['사진', 'PHOTO', '스튜디오', 'STUDIO'], subcategory: 'photography', primary: 'professional', excludeKeywords: ['피부', 'SKIN', '댄스', 'DANCE', '음악', 'MUSIC'] },
  { keywords: ['간판', 'SIGN'], subcategory: 'signage', primary: 'professional' },
  { keywords: ['웨딩', 'WEDDING', '결혼'], subcategory: 'wedding', primary: 'professional' },
  { keywords: ['장례', 'FUNERAL', 'MORTUARY'], subcategory: 'funeral', primary: 'professional' },

  // === SHOPPING ===
  { keywords: ['전자', 'ELECTRONIC', '컴퓨터', 'COMPUTER'], subcategory: 'electronics', primary: 'shopping' },
  { keywords: ['가구', 'FURNITURE'], subcategory: 'furniture', primary: 'shopping' },
  { keywords: ['보석', 'JEWELRY', '금은방', '귀금속'], subcategory: 'jewelry', primary: 'shopping' },
  { keywords: ['꽃집', 'FLOWER', 'FLORIST', '플라워'], subcategory: 'florist', primary: 'shopping' },
  { keywords: ['안경', 'OPTICAL', 'EYEGLASS', '검안'], subcategory: 'optical', primary: 'shopping' },

  // === COMMUNITY ===
  { keywords: ['교회', 'CHURCH', '성당', 'CATHOLIC'], subcategory: 'church', primary: 'community' },
  { keywords: ['절', '사찰', 'TEMPLE', 'BUDDHIST'], subcategory: 'temple', primary: 'community' },
];

// Merge: additional patterns take priority (added at the front for specific matches)
const ALL_PATTERNS = [...ADDITIONAL_PATTERNS, ...EXISTING_PATTERNS];

function detectSubcategory(nameKo: string, nameEn: string | null, currentPrimary: string): string | null {
  const combinedName = `${nameKo} ${nameEn || ''}`.toUpperCase();

  for (const pattern of ALL_PATTERNS) {
    if (pattern.primary !== currentPrimary) continue;

    const hasKeyword = pattern.keywords.some(keyword =>
      combinedName.includes(keyword.toUpperCase())
    );
    if (!hasKeyword) continue;

    if (pattern.excludeKeywords) {
      const hasExclude = pattern.excludeKeywords.some(keyword =>
        combinedName.includes(keyword.toUpperCase())
      );
      if (hasExclude) continue;
    }

    return pattern.subcategory;
  }

  return null;
}

async function main() {
  console.log('=== Fix Remaining NULL Subcategories ===\n');

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
  const categoryBySlug = new Map(allCategories.map(c => [c.slug, c]));
  const slugToId = new Map(allCategories.map(c => [c.slug, c.id]));

  console.log('  NULL subcategory by primary category:');
  for (const g of beforeNullByPrimary) {
    const cat = categoryById.get(g.primaryCategoryId);
    console.log(`    ${cat?.nameKo || 'unknown'} (${cat?.slug}): ${g._count}`);
  }
  console.log();

  // ────────────────────────────────────────────
  // Phase 0.5: Ensure new subcategories exist
  // ────────────────────────────────────────────
  console.log('Phase 0.5: Ensuring new subcategories exist...\n');

  let subcategoriesCreated = 0;
  for (const sub of NEW_SUBCATEGORIES) {
    const existing = categoryBySlug.get(sub.slug);
    if (existing) {
      console.log(`  ✓ ${sub.slug} already exists (id=${existing.id})`);
      continue;
    }

    const parent = categoryBySlug.get(sub.parent);
    if (!parent) {
      console.error(`  ✗ Parent '${sub.parent}' not found for ${sub.slug}!`);
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
    slugToId.set(created.slug, created.id);
    subcategoriesCreated++;
    console.log(`  + Created ${sub.slug} (id=${created.id}, parent=${sub.parent})`);
  }
  console.log(`  ${subcategoriesCreated} new subcategories created\n`);

  // ────────────────────────────────────────────
  // Phase 1: RadioKorea mapping updates
  // ────────────────────────────────────────────
  console.log('Phase 1: RadioKorea mapping updates (UID-based)...\n');

  // Load RadioKorea source data
  const radiokoreaDataPath = path.resolve(__dirname, '../../radiokorea_businesses_v2.json');
  const radiokoreaRaw = fs.readFileSync(radiokoreaDataPath, 'utf-8');
  const radiokoreaData = JSON.parse(radiokoreaRaw);
  const radiokoreaBusinesses: RadioKoreaBusiness[] = radiokoreaData.businesses || radiokoreaData;
  const radiokoreaMap = new Map<string, string>();
  for (const biz of radiokoreaBusinesses) {
    radiokoreaMap.set(biz.uid, biz.category_code);
  }
  console.log(`  RadioKorea lookup map: ${radiokoreaMap.size} entries`);

  // Get all NULL-subcategory businesses
  const nullBusinesses = await prisma.business.findMany({
    where: { subcategoryId: null },
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      primaryCategoryId: true,
      sourceKeys: true,
    },
  });
  console.log(`  Businesses with NULL subcategory: ${nullBusinesses.length}\n`);

  const rkStats = { checked: 0, updated: 0, noUid: 0, noCode: 0, noSub: 0 };
  const rkUpdates: Array<{ id: number; subcategoryId: number }> = [];

  for (const biz of nullBusinesses) {
    const sourceKeys = (biz.sourceKeys as SourceKey[] | null) || [];
    const rkKey = sourceKeys.find(sk => sk.source === 'radiokorea' && sk.uid);
    if (!rkKey || !rkKey.uid) {
      rkStats.noUid++;
      continue;
    }

    rkStats.checked++;
    const categoryCode = radiokoreaMap.get(rkKey.uid);
    if (!categoryCode) {
      rkStats.noCode++;
      continue;
    }

    const mapping = mapRadioKoreaCategory(categoryCode);
    if (!mapping.sub) {
      rkStats.noSub++;
      continue;
    }

    const subId = slugToId.get(mapping.sub);
    if (!subId) continue;

    rkUpdates.push({ id: biz.id, subcategoryId: subId });
  }

  console.log(`  RadioKorea NULL businesses with UID: ${rkStats.checked}`);
  console.log(`  No category code in source: ${rkStats.noCode}`);
  console.log(`  Mapping has no sub: ${rkStats.noSub}`);
  console.log(`  To update: ${rkUpdates.length}`);

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
  rkStats.updated = rkUpdates.length;
  console.log(`  Updated: ${rkStats.updated}\n`);

  // ────────────────────────────────────────────
  // Phase 2: KoreaDaily SKIP item mapping
  // ────────────────────────────────────────────
  console.log('Phase 2: KoreaDaily previously-skipped items + cross-category fixes...\n');

  // Load KoreaDaily source data
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

  // Re-fetch NULL businesses (some were fixed in Phase 1)
  const nullBusinesses2 = await prisma.business.findMany({
    where: { subcategoryId: null },
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      primaryCategoryId: true,
      sourceKeys: true,
    },
  });
  console.log(`  Remaining NULL after Phase 1: ${nullBusinesses2.length}\n`);

  const kdStats = { total: 0, mapped: 0, crossCategory: 0, sameCategory: 0, noSource: 0, noMapping: 0 };
  const kdUpdates: Array<{ id: number; subcategoryId: number; primaryCategoryId?: number }> = [];

  for (const biz of nullBusinesses2) {
    const sourceKeys = (biz.sourceKeys as SourceKey[] | null) || [];
    const kdKey = sourceKeys.find(sk => sk.source === 'koreadaily');
    if (!kdKey) continue;

    kdStats.total++;

    const sourceData = koreadailyMap.get(kdKey.uid);
    if (!sourceData) {
      kdStats.noSource++;
      continue;
    }

    const subKey = `${sourceData.category_id}-${sourceData.sub_idx}`;
    const subSlug = KOREADAILY_SUB_MAPPING[subKey];
    if (!subSlug) {
      kdStats.noMapping++;
      continue;
    }

    kdStats.mapped++;

    // Check if this is a cross-category fix
    const crossFix = KOREADAILY_CROSS_CATEGORY_FIXES[subKey];
    if (crossFix) {
      const newPrimaryId = slugToId.get(crossFix.primary);
      const newSubId = slugToId.get(crossFix.sub);
      if (!newPrimaryId || !newSubId) continue;

      kdUpdates.push({
        id: biz.id,
        subcategoryId: newSubId,
        primaryCategoryId: newPrimaryId,
      });
      kdStats.crossCategory++;
    } else {
      const newSubId = slugToId.get(subSlug);
      if (!newSubId) continue;

      kdUpdates.push({ id: biz.id, subcategoryId: newSubId });
      kdStats.sameCategory++;
    }
  }

  console.log(`  KoreaDaily NULL businesses: ${kdStats.total}`);
  console.log(`  No source data: ${kdStats.noSource}`);
  console.log(`  No mapping: ${kdStats.noMapping}`);
  console.log(`  Same-category sub updates: ${kdStats.sameCategory}`);
  console.log(`  Cross-category fixes: ${kdStats.crossCategory}`);
  console.log(`  Total to update: ${kdUpdates.length}`);

  for (let i = 0; i < kdUpdates.length; i += BATCH_SIZE) {
    const batch = kdUpdates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(u => {
        const data: { subcategoryId: number; primaryCategoryId?: number } = {
          subcategoryId: u.subcategoryId,
        };
        if (u.primaryCategoryId) {
          data.primaryCategoryId = u.primaryCategoryId;
        }
        return prisma.business.update({
          where: { id: u.id },
          data,
        });
      })
    );
  }
  console.log(`  Updated: ${kdUpdates.length}\n`);

  // ────────────────────────────────────────────
  // Phase 3: Name-based pattern matching (NULL only)
  // ────────────────────────────────────────────
  console.log('Phase 3: Name-based pattern matching (NULL only)...\n');

  // Re-fetch NULL businesses
  const nullBusinesses3 = await prisma.business.findMany({
    where: { subcategoryId: null },
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      primaryCategoryId: true,
    },
  });
  console.log(`  Remaining NULL after Phase 2: ${nullBusinesses3.length}`);

  const patternStats: Map<string, number> = new Map();
  const patternUpdates: Array<{ id: number; subcategoryId: number }> = [];

  for (const biz of nullBusinesses3) {
    const primaryCat = categoryById.get(biz.primaryCategoryId);
    if (!primaryCat) continue;

    const detected = detectSubcategory(biz.nameKo, biz.nameEn, primaryCat.slug);
    if (!detected) continue;

    const subId = slugToId.get(detected);
    if (!subId) continue;

    patternUpdates.push({ id: biz.id, subcategoryId: subId });
    const key = `${primaryCat.slug}/${detected}`;
    patternStats.set(key, (patternStats.get(key) || 0) + 1);
  }

  console.log(`  Matched by name patterns: ${patternUpdates.length}\n`);

  // Print pattern match breakdown
  const sortedPatternStats = Array.from(patternStats.entries()).sort((a, b) => b[1] - a[1]);
  for (const [key, count] of sortedPatternStats) {
    console.log(`    ${key}: ${count}`);
  }
  console.log();

  // Batch update
  console.log(`  Updating in batches of ${BATCH_SIZE}...`);
  let patternUpdated = 0;
  for (let i = 0; i < patternUpdates.length; i += BATCH_SIZE) {
    const batch = patternUpdates.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map(u =>
        prisma.business.update({
          where: { id: u.id },
          data: { subcategoryId: u.subcategoryId },
        })
      )
    );
    patternUpdated += batch.length;
    if ((i + BATCH_SIZE) % 2000 < BATCH_SIZE) {
      console.log(`    ${Math.min(i + BATCH_SIZE, patternUpdates.length)} / ${patternUpdates.length}`);
    }
  }
  console.log(`  Pattern-matched updates complete: ${patternUpdated}\n`);

  // ────────────────────────────────────────────
  // Phase 4: After Snapshot + Report
  // ────────────────────────────────────────────
  console.log('Phase 4: After snapshot...\n');

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
  console.log(`  Total reduction: ${beforeNullCount - afterNullCount} businesses gained subcategory`);
  console.log(`    Phase 1 (RadioKorea mapping): ${rkStats.updated}`);
  console.log(`    Phase 2 (KoreaDaily un-skip): ${kdUpdates.length}`);
  console.log(`    Phase 3 (Name patterns): ${patternUpdated}`);
  if (subcategoriesCreated > 0) {
    console.log(`  New subcategories created: ${subcategoriesCreated}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error('Fatal error:', err);
  await prisma.$disconnect();
  process.exit(1);
});
