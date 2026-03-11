#!/usr/bin/env npx tsx
/**
 * Bilingual Audit Script
 *
 * Checks that pages render correctly with Korean + English labels.
 * Run: npm run audit:bilingual or npx tsx scripts/audit-bilingual.ts
 */

import { UI_LABELS, getCityNameKo, formatBilingual } from '../../src/lib/i18n/labels';
import { generateCategoryFAQs } from '../../src/components/FAQSection';

interface AuditResult {
  check: string;
  passed: boolean;
  details?: string;
}

const results: AuditResult[] = [];

function log(check: string, passed: boolean, details?: string) {
  results.push({ check, passed, details });
  const status = passed ? '✅' : '❌';
  console.log(`${status} ${check}`);
  if (details) {
    console.log(`   ${details}`);
  }
}

// Test 1: UI_LABELS has both ko and en
console.log('\n=== UI Labels Check ===\n');
for (const [key, value] of Object.entries(UI_LABELS)) {
  const hasKo = 'ko' in value && typeof value.ko === 'string' && value.ko.length > 0;
  const hasEn = 'en' in value && typeof value.en === 'string' && value.en.length > 0;
  log(`UI_LABELS.${key}`, hasKo && hasEn, hasKo && hasEn ? `ko: "${value.ko}", en: "${value.en}"` : 'Missing translation');
}

// Test 2: Major cities have Korean names
console.log('\n=== City Names Check ===\n');
const majorCities = ['los-angeles', 'irvine', 'fullerton', 'garden-grove', 'koreatown', 'torrance'];
for (const city of majorCities) {
  const ko = getCityNameKo(city);
  const hasDifferentKo = ko !== city.replace(/-/g, ' ');
  log(`City: ${city}`, hasDifferentKo, `Korean: "${ko}"`);
}

// Test 3: formatBilingual works correctly
console.log('\n=== Bilingual Formatting Check ===\n');
const testCases = [
  { ko: '김치식당', en: 'Kimchi Restaurant', expected: '김치식당 | Kimchi Restaurant' },
  { ko: '한국식당', en: null, expected: '한국식당' },
  { ko: '삼성', en: '삼성', expected: '삼성' }, // Same text should not repeat
];
for (const tc of testCases) {
  const result = formatBilingual(tc.ko, tc.en);
  log(`formatBilingual("${tc.ko}", "${tc.en}")`, result === tc.expected, `Got: "${result}"`);
}

// Test 4: FAQs are bilingual when count > 0
console.log('\n=== FAQ Generation Check ===\n');
const faqsWithResults = generateCategoryFAQs({
  categoryNameEn: 'Dental',
  categoryNameKo: '치과',
  city: 'Los Angeles',
  cityKo: '로스앤젤레스',
  state: 'CA',
  count: 50,
});

log('FAQs generated when count > 0', faqsWithResults.length > 0, `${faqsWithResults.length} FAQs`);

for (let i = 0; i < faqsWithResults.length; i++) {
  const faq = faqsWithResults[i];
  const hasKorean = /[\uAC00-\uD7AF]/.test(faq.question); // Korean character range
  const hasEnglish = /[a-zA-Z]/.test(faq.question);
  log(`FAQ ${i + 1} is bilingual`, hasKorean && hasEnglish, faq.question.substring(0, 60) + '...');
}

// Test 5: FAQ count accuracy (no misleading claims)
console.log('\n=== FAQ Content Accuracy Check ===\n');
const countMatch = faqsWithResults[0].answer.includes('50');
log('FAQ answer mentions correct count', countMatch, `Contains "50": ${countMatch}`);

// Summary
console.log('\n=== Summary ===\n');
const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);
console.log(`Total: ${results.length}`);

if (failed > 0) {
  console.log('\n❌ Audit failed with errors');
  process.exit(1);
} else {
  console.log('\n✅ All checks passed');
  process.exit(0);
}
