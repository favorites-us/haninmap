/**
 * Category Outliers Audit
 * Samples records per subcategory and flags potential mismatches
 * Run: npx tsx scripts/audit-category-outliers.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SourceKey {
  source: string;
  uid: string;
}

// Keyword rules for mismatch detection
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  medical: ['병원', '의원', '클리닉', '내과', '외과', '전문의', '진료', '치료', 'MD', 'clinic', 'hospital'],
  dental: ['치과', '치아', '임플란트', '교정', 'dental', 'dentist'],
  legal: ['변호사', '법률', '법무', 'law', 'attorney', 'lawyer'],
  food: ['식당', '레스토랑', '음식', '맛집', 'restaurant', 'food', 'BBQ', '고기', '회', '국수'],
  beauty: ['미용', '뷰티', '헤어', '네일', '스킨', 'salon', 'beauty', 'spa'],
  auto: ['자동차', '오토', '타이어', '정비', '바디샵', 'auto', 'car', 'tire'],
  'home-services': ['이삿짐', '청소', '배관', '전기', '건축', '인테리어', 'moving', 'cleaning', 'plumbing'],
  shopping: ['마트', '마켓', '상점', '판매', '도매', 'shop', 'store', 'market'],
  insurance: ['보험', 'insurance'],
  'real-estate': ['부동산', '리얼티', 'realty', 'real estate'],
  financial: ['회계', '세무', '은행', '금융', 'CPA', 'bank', 'accounting'],
  education: ['학원', '학교', '교육', '태권도', 'school', 'academy', 'tutoring'],
  travel: ['여행', '항공', '투어', 'travel', 'tour', 'airline'],
  community: ['교회', '성당', '사찰', '단체', 'church', 'temple', 'organization'],
  professional: ['사진', '인쇄', '광고', '웨딩', 'photo', 'print', 'wedding'],
};

// Keywords that might indicate wrong category
const MISMATCH_SIGNALS: Record<string, { shouldBe: string; keywords: string[] }[]> = {
  medical: [
    { shouldBe: 'shopping', keywords: ['건강식품', '홍삼', '인삼', '비타민', '영양제', '건강원'] },
    { shouldBe: 'beauty', keywords: ['미용', '뷰티', '에스테틱'] },
  ],
  shopping: [
    { shouldBe: 'medical', keywords: ['의원', '클리닉', '진료', '치료', '한의원'] },
  ],
  food: [
    { shouldBe: 'shopping', keywords: ['식품점', '슈퍼', '마트', '도매'] },
  ],
  beauty: [
    { shouldBe: 'community', keywords: ['헬스', '피트니스', '짐', '체육관', 'gym', 'fitness'] },
  ],
  professional: [
    { shouldBe: 'home-services', keywords: ['세탁', '클리닝', '드라이'] },
  ],
};

interface OutlierSample {
  id: number;
  nameKo: string;
  nameEn: string | null;
  phone: string | null;
  address: string | null;
  source: string;
  primaryCategory: string;
  subcategory: string | null;
  flags: string[];
}

interface OutlierResult {
  timestamp: string;
  samplesBySubcategory: Record<string, OutlierSample[]>;
  flaggedRecords: OutlierSample[];
  flagSummary: Record<string, number>;
}

function detectMismatches(
  nameKo: string,
  nameEn: string | null,
  primarySlug: string
): string[] {
  const flags: string[] = [];
  const combinedName = `${nameKo} ${nameEn || ''}`.toLowerCase();

  // Check if name contains keywords suggesting different category
  const signals = MISMATCH_SIGNALS[primarySlug];
  if (signals) {
    for (const signal of signals) {
      for (const kw of signal.keywords) {
        if (combinedName.includes(kw.toLowerCase())) {
          flags.push(`POSSIBLE_${signal.shouldBe.toUpperCase()}: contains "${kw}"`);
        }
      }
    }
  }

  // Check for specific patterns
  if (primarySlug === 'medical') {
    if (combinedName.includes('흑염소') || combinedName.includes('농축')) {
      flags.push('HEALTH_SUPPLEMENT: 흑염소농축 should be shopping');
    }
    if (combinedName.includes('검안') && !combinedName.includes('안과')) {
      flags.push('OPTOMETRY: 검안 might be optometry, not ophthalmology');
    }
  }

  if (primarySlug === 'food') {
    if (combinedName.includes('노래방') || combinedName.includes('가라오케') || combinedName.includes('룸')) {
      flags.push('NIGHTLIFE: should be food>nightlife');
    }
  }

  if (primarySlug === 'beauty') {
    if (combinedName.includes('헬스') || combinedName.includes('피트니스') || combinedName.includes('gym')) {
      flags.push('FITNESS: should be community>fitness');
    }
    if (combinedName.includes('찜질방') || combinedName.includes('목욕')) {
      flags.push('BATHHOUSE: consider community or separate category');
    }
  }

  if (primarySlug === 'professional') {
    if (combinedName.includes('세탁') || combinedName.includes('클리닝') || combinedName.includes('드라이')) {
      flags.push('LAUNDRY: should be home-services>laundry');
    }
  }

  if (primarySlug === 'home-services') {
    if (combinedName.includes('택배') || combinedName.includes('배송') || combinedName.includes('퀵')) {
      flags.push('SHIPPING: consider home-services>shipping');
    }
    if (combinedName.includes('창고') || combinedName.includes('통관') || combinedName.includes('수출입')) {
      flags.push('LOGISTICS: consider home-services>logistics');
    }
  }

  return flags;
}

async function main() {
  console.log('=== Category Outliers Audit ===\n');

  const result: OutlierResult = {
    timestamp: new Date().toISOString(),
    samplesBySubcategory: {},
    flaggedRecords: [],
    flagSummary: {},
  };

  // Get all subcategories
  const subcategories = await prisma.category.findMany({
    where: { level: 'sub' },
    select: { id: true, slug: true, nameKo: true },
  });

  console.log(`Found ${subcategories.length} subcategories`);

  // Sample 50 records per subcategory
  for (const subcat of subcategories) {
    const businesses = await prisma.business.findMany({
      where: { subcategoryId: subcat.id },
      select: {
        id: true,
        nameKo: true,
        nameEn: true,
        phoneRaw: true,
        addressRaw: true,
        sourceKeys: true,
        primaryCategory: { select: { slug: true } },
        subcategory: { select: { slug: true } },
      },
      take: 50,
      orderBy: { id: 'asc' },
    });

    if (businesses.length === 0) continue;

    const samples: OutlierSample[] = [];
    for (const biz of businesses) {
      const keys = (biz.sourceKeys as SourceKey[]) || [];
      const source = keys.find(k => k.source === 'radiokorea')
        ? 'radiokorea'
        : keys.find(k => k.source === 'koreadaily')
          ? 'koreadaily'
          : 'unknown';

      const flags = detectMismatches(
        biz.nameKo,
        biz.nameEn,
        biz.primaryCategory?.slug || 'unknown'
      );

      const sample: OutlierSample = {
        id: biz.id,
        nameKo: biz.nameKo,
        nameEn: biz.nameEn,
        phone: biz.phoneRaw,
        address: biz.addressRaw,
        source,
        primaryCategory: biz.primaryCategory?.slug || 'unknown',
        subcategory: biz.subcategory?.slug || null,
        flags,
      };

      samples.push(sample);

      if (flags.length > 0) {
        result.flaggedRecords.push(sample);
        for (const flag of flags) {
          const flagType = flag.split(':')[0];
          result.flagSummary[flagType] = (result.flagSummary[flagType] || 0) + 1;
        }
      }
    }

    result.samplesBySubcategory[subcat.slug] = samples;
  }

  // Also sample businesses without subcategory
  const noSubcat = await prisma.business.findMany({
    where: { subcategoryId: null },
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
      phoneRaw: true,
      addressRaw: true,
      sourceKeys: true,
      primaryCategory: { select: { slug: true } },
    },
    take: 200,
    orderBy: { id: 'asc' },
  });

  const noSubcatSamples: OutlierSample[] = [];
  for (const biz of noSubcat) {
    const keys = (biz.sourceKeys as SourceKey[]) || [];
    const source = keys.find(k => k.source === 'radiokorea')
      ? 'radiokorea'
      : keys.find(k => k.source === 'koreadaily')
        ? 'koreadaily'
        : 'unknown';

    const flags = detectMismatches(
      biz.nameKo,
      biz.nameEn,
      biz.primaryCategory?.slug || 'unknown'
    );

    const sample: OutlierSample = {
      id: biz.id,
      nameKo: biz.nameKo,
      nameEn: biz.nameEn,
      phone: biz.phoneRaw,
      address: biz.addressRaw,
      source,
      primaryCategory: biz.primaryCategory?.slug || 'unknown',
      subcategory: null,
      flags,
    };

    noSubcatSamples.push(sample);

    if (flags.length > 0) {
      result.flaggedRecords.push(sample);
      for (const flag of flags) {
        const flagType = flag.split(':')[0];
        result.flagSummary[flagType] = (result.flagSummary[flagType] || 0) + 1;
      }
    }
  }
  result.samplesBySubcategory['_no_subcategory'] = noSubcatSamples;

  // Write JSON report
  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(reportsDir, 'category_outliers.json'),
    JSON.stringify(result, null, 2)
  );

  // Write Markdown report
  let md = `# Category Outliers Audit\n\n`;
  md += `**Generated:** ${result.timestamp}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Subcategories sampled | ${Object.keys(result.samplesBySubcategory).length} |\n`;
  md += `| Total flagged records | ${result.flaggedRecords.length} |\n\n`;

  md += `## Flag Summary\n\n`;
  md += `| Flag Type | Count |\n|-----------|-------|\n`;
  const sortedFlags = Object.entries(result.flagSummary).sort((a, b) => b[1] - a[1]);
  for (const [flag, count] of sortedFlags) {
    md += `| ${flag} | ${count} |\n`;
  }

  md += `\n## Flagged Records Sample (first 50)\n\n`;
  md += `| ID | Name | Primary | Sub | Source | Flags |\n`;
  md += `|----|------|---------|-----|--------|-------|\n`;
  for (const rec of result.flaggedRecords.slice(0, 50)) {
    md += `| ${rec.id} | ${rec.nameKo.substring(0, 20)} | ${rec.primaryCategory} | ${rec.subcategory || '-'} | ${rec.source} | ${rec.flags.join('; ')} |\n`;
  }

  fs.writeFileSync(path.join(reportsDir, 'category_outliers.md'), md);

  console.log(`\nFlagged records: ${result.flaggedRecords.length}`);
  console.log('\nFlag summary:');
  for (const [flag, count] of sortedFlags) {
    console.log(`  ${flag}: ${count}`);
  }

  console.log('\nReports written to:');
  console.log('  - reports/category_outliers.json');
  console.log('  - reports/category_outliers.md');

  await prisma.$disconnect();
}

main().catch(console.error);
