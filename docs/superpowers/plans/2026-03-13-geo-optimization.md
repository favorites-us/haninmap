# GEO Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Optimize haninmap.com for LLM-based search engines by adding LLM-specific endpoints, enhancing editorial content, and strengthening Schema.org markup.

**Architecture:** Three independent work streams — (1) LLM endpoints as new Next.js route handlers, (2) content enrichment by enhancing existing components with additional data, (3) Schema.org markup improvements in the central `meta.ts` module and consuming pages.

**Tech Stack:** Next.js 14 App Router, TypeScript, Prisma ORM, Supabase PostgreSQL

---

## Task 1: LLM Endpoints (llms.txt, llms-full.txt, robots.txt)

**Independent — no shared files with other tasks.**

**Files:**
- Create: `src/app/llms.txt/route.ts`
- Create: `src/app/llms-full.txt/route.ts`
- Modify: `src/app/robots.txt/route.ts`

- [ ] **Step 1: Create `/llms.txt` route handler**

Create `src/app/llms.txt/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

const BASE_URL = 'https://www.haninmap.com';

export async function GET() {
  // Fetch published guides
  const guides = await prisma.guideContent.findMany({
    where: { status: 'published' },
    select: { slug: true, titleEn: true, summary: true },
    orderBy: { viewCount: 'desc' },
  });

  // Fetch category list
  const categories = await prisma.category.findMany({
    where: { level: 'primary' },
    select: { nameEn: true, nameKo: true },
    orderBy: { nameEn: 'asc' },
  });

  // Fetch coverage stats
  const usCities = await prisma.business.groupBy({
    by: ['state'],
    where: { countryCode: 'US' },
    _count: true,
  });
  const caCount = await prisma.business.count({ where: { countryCode: 'CA' } });
  const auCount = await prisma.business.count({ where: { countryCode: 'AU' } });
  const totalCount = await prisma.business.count();

  const usStates = usCities.map(s => s.state).sort().join(', ');

  const categoriesSection = categories
    .map(c => `- ${c.nameEn}: Korean ${c.nameEn.toLowerCase()} (${c.nameKo})`)
    .join('\n');

  const guidesSection = guides
    .map(g => `- [${g.titleEn}](${BASE_URL}/guides/${g.slug}): ${g.summary.slice(0, 100)}`)
    .join('\n');

  const content = `# HaninMap (한인맵)

> Korean business directory for the US, Canada, and Australia.
> Find Korean-speaking doctors, dentists, lawyers, CPAs, restaurants, and more.

## About
HaninMap is a bilingual (Korean/English) directory helping Korean Americans,
Korean Canadians, and Korean Australians find local Korean-speaking businesses
and professionals. ${totalCount.toLocaleString()}+ verified listings.

## Categories
${categoriesSection}

## Guides
${guidesSection}

## Coverage
- US: ${usStates}
- Canada: ON, BC (Toronto, Vancouver) — ${caCount.toLocaleString()} businesses
- Australia: NSW (Sydney) — ${auCount.toLocaleString()} businesses

## Optional
- [Full business listing](${BASE_URL}/llms-full.txt)
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
```

- [ ] **Step 2: Create `/llms-full.txt` route handler**

Create `src/app/llms-full.txt/route.ts`:

```typescript
import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

const MAX_BYTES = 450_000; // Stop adding before 450KB UTF-8

export async function GET() {
  // Fetch high-quality businesses matching shouldIndexL3 criteria
  const businesses = await prisma.business.findMany({
    where: {
      googlePlace: {
        rating: { gte: 4.2 },
        userRatingsTotal: { gte: 10 },
        fetchStatus: 'ok',
      },
    },
    include: {
      primaryCategory: { select: { nameEn: true } },
      googlePlace: {
        select: {
          rating: true,
          userRatingsTotal: true,
          editorialSummary: true,
          phoneE164: true,
        },
      },
    },
    orderBy: [
      { state: 'asc' },
      { city: 'asc' },
      { primaryCategory: { nameEn: 'asc' } },
      { googlePlace: { rating: 'desc' } },
    ],
  });

  let content = `# HaninMap — Full Business Listing\n\n`;
  content += `> High-quality Korean businesses (4.2+ rating, 10+ reviews)\n`;
  content += `> Generated: ${new Date().toISOString().split('T')[0]}\n\n`;

  let currentState = '';
  let currentCityCategory = '';
  let cityCount = 0;
  let bizCountInGroup = 0;
  const statesCityCounts = new Map<string, number>();

  for (const biz of businesses) {
    // Check size limit
    if (new TextEncoder().encode(content).length > MAX_BYTES) break;

    // Enforce top 10 cities per state, top 10 businesses per city/category
    const stateKey = biz.state;
    const cityCatKey = `${biz.state}|${biz.city}|${biz.primaryCategory.nameEn}`;

    if (stateKey !== currentState) {
      currentState = stateKey;
      cityCount = 0;
      statesCityCounts.set(stateKey, 0);
      content += `## ${stateKey}\n\n`;
    }

    if (cityCatKey !== currentCityCategory) {
      const currentCitiesForState = statesCityCounts.get(stateKey) || 0;
      if (currentCitiesForState >= 10) continue; // Skip beyond top 10 cities
      statesCityCounts.set(stateKey, currentCitiesForState + 1);
      currentCityCategory = cityCatKey;
      bizCountInGroup = 0;
      const cityDisplay = biz.city.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      content += `### ${cityDisplay} — ${biz.primaryCategory.nameEn}\n`;
    }

    if (bizCountInGroup >= 10) continue; // Top 10 per group
    bizCountInGroup++;

    const name = biz.nameEn || biz.nameKo;
    const gp = biz.googlePlace!;
    const phone = gp.phoneE164 || biz.phoneE164 || biz.phoneRaw || '';
    const desc = gp.editorialSummary || '';
    content += `- **${name}** (${gp.rating!.toFixed(1)}★, ${gp.userRatingsTotal} reviews)`;
    if (phone) content += ` — ${phone}`;
    content += `\n`;
    if (desc) content += `  ${desc.slice(0, 150)}\n`;
  }

  // Hard floor
  if (businesses.length === 0) {
    content += `\nNo businesses currently meet the quality criteria. Visit https://www.haninmap.com for the full directory.\n`;
  }

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
    },
  });
}
```

- [ ] **Step 3: Update robots.txt with llms.txt reference**

In `src/app/robots.txt/route.ts`, add after the `Sitemap:` line:

```typescript
// Add to the robotsTxt string, after the Sitemap line:
// LLM context
// llms.txt: ${BASE_URL}/llms.txt
```

The full updated string should end with:
```
Sitemap: ${BASE_URL}/sitemap.xml

# LLM context
# See https://www.haninmap.com/llms.txt for site overview
```

- [ ] **Step 4: Verify endpoints**

Run: `npm run build` — confirm no TypeScript errors.
After local dev start, verify:
- `curl http://localhost:3000/llms.txt` returns markdown
- `curl http://localhost:3000/llms-full.txt` returns business listing
- `curl http://localhost:3000/robots.txt` includes llms.txt comment

- [ ] **Step 5: Commit**

```bash
git add src/app/llms.txt/route.ts src/app/llms-full.txt/route.ts src/app/robots.txt/route.ts
git commit -m "feat: add llms.txt and llms-full.txt endpoints for GEO optimization"
```

---

## Task 2: CategoryIntro Enhancement + Category Page Props

**Files:**
- Modify: `src/components/CategoryIntro.tsx` (lines 1-102)
- Modify: `src/app/[state]/[city]/[category]/page.tsx` (lines 280-506)
- Modify: `src/lib/pages/international-listing.tsx` (lines 266-276)

- [ ] **Step 1: Add new props to CategoryIntro**

In `src/components/CategoryIntro.tsx`, add to the `CategoryIntroProps` interface:

```typescript
interface CategoryIntroProps {
  city: string;
  state: string;
  categoryNameEn: string;
  categoryNameKo: string;
  count: number;
  isSubcategory?: boolean;
  avgRating?: number | null;
  reviewCount?: number | null;
  topBusinessNames?: string[];   // NEW
  subcategories?: string[];       // NEW
}
```

Update the component function to destructure new props:
```typescript
export function CategoryIntro({
  city,
  state,
  categoryNameEn,
  categoryNameKo,
  count,
  avgRating,
  reviewCount,
  topBusinessNames,    // NEW
  subcategories,       // NEW
}: CategoryIntroProps) {
```

- [ ] **Step 2: Weave new data into Korean prose block**

After the existing `contextKo` sentence in the Korean `<p>`, add:

```typescript
{topBusinessNames && topBusinessNames.length > 0 && (
  <>{' '}평점이 높은 곳으로는 {topBusinessNames.join(', ')} 등이 있습니다.</>
)}
{subcategories && subcategories.length > 0 && (
  <>{' '}{subcategories.join(', ')} 등의 전문 분야를 다루고 있습니다.</>
)}
```

And in the English `<p>`:

```typescript
{topBusinessNames && topBusinessNames.length > 0 && (
  <>{' '}Top-rated options include {topBusinessNames.join(', ')}.</>
)}
{subcategories && subcategories.length > 0 && (
  <>{' '}Specialties include {subcategories.join(', ')}.</>
)}
```

- [ ] **Step 3: Pass new props from category page**

In `src/app/[state]/[city]/[category]/page.tsx`, after the existing `businesses` query (around line 297), add a query to get top business names and subcategories. Add before the `return` statement:

```typescript
// Top 3 businesses by rating for CategoryIntro
const topBusinesses = sortedBusinesses
  .filter(b => b.googlePlace?.rating)
  .sort((a, b) => (b.googlePlace?.rating || 0) - (a.googlePlace?.rating || 0))
  .slice(0, 3)
  .map(b => b.nameEn || b.nameKo);

// Distinct subcategory names for this category
const subcategoryNames = categoryInfo.level === 'primary'
  ? await prisma.category.findMany({
      where: {
        parentId: categoryInfo.id,
        subBusinesses: {
          some: {
            city: isAllCities ? { not: 'Unknown' } : cityNormalized,
            state: stateNormalized,
          },
        },
      },
      select: { nameKo: true },
      take: 5,
    }).then(cats => cats.map(c => c.nameKo))
  : [];
```

Then update the `<CategoryIntro>` call (around line 498-506) to pass the new props:

```tsx
<CategoryIntro
  city={city}
  state={state}
  categoryNameEn={categoryInfo.nameEn}
  categoryNameKo={categoryInfo.nameKo}
  count={totalCount}
  avgRating={ratingAgg._avg.rating}
  reviewCount={ratingAgg._sum.userRatingsTotal}
  topBusinessNames={topBusinesses}
  subcategories={subcategoryNames}
/>
```

- [ ] **Step 4: Pass new props from international listing page**

In `src/lib/pages/international-listing.tsx`, apply the same pattern around lines 266-276. The data sourcing is similar — extract top business names from the already-fetched business list, query subcategories from prisma.

Since the international page also fetches `businesses`, derive `topBusinesses` the same way. For subcategories, add the same prisma query.

Update the `<CategoryIntro>` call to include `topBusinessNames` and `subcategories`.

- [ ] **Step 5: Verify and commit**

Run: `npm run build` — confirm no TypeScript errors.

```bash
git add src/components/CategoryIntro.tsx src/app/[state]/[city]/[category]/page.tsx src/lib/pages/international-listing.tsx
git commit -m "feat: enhance CategoryIntro with top businesses and subcategories for GEO"
```

---

## Task 3: FAQ Enhancement

**Files:**
- Modify: `src/components/FAQSection.tsx` (lines 33-217)

- [ ] **Step 1: Add new FAQ templates to category-specific sets**

In `src/components/FAQSection.tsx`, add new entries to existing categories in `CATEGORY_SPECIFIC_FAQS`:

For `medical`, append after the existing 2 FAQs:
```typescript
{
  question: `${cityKo}에서 보험 없이 갈 수 있는 한인 병원은?`,
  answer: `한인맵에 등록된 ${cityKo} 한인 병원 중 보험 미가입자도 진료 가능한 곳이 있습니다. 방문 전 전화로 self-pay 가능 여부와 할인 프로그램을 문의하세요.`,
},
{
  question: `한인 병원 첫 방문 시 필요한 것은?`,
  answer: `신분증(ID), 보험카드(있는 경우), 복용 중인 약 목록을 준비하세요. 한인 병원은 한국어로 접수와 상담이 가능하여 첫 방문도 편안합니다.`,
},
```

For `dental`, append:
```typescript
{
  question: `${cityKo}에서 보험 없이 갈 수 있는 한인 치과는?`,
  answer: `많은 한인 치과가 보험 없이도 진료를 제공하며, 자체 할인 플랜이나 분할 납부를 지원합니다. 한인맵에서 ${cityKo} 한인 치과를 확인하고 직접 문의하세요.`,
},
{
  question: `한인 치과 첫 방문 시 필요한 것은?`,
  answer: `신분증, 보험카드(있는 경우), 기존 치과 기록(있으면)을 준비하세요. 첫 방문 시 X-ray 촬영과 전반적인 구강 검진이 진행됩니다.`,
},
```

For `legal`, append:
```typescript
{
  question: `${cityKo}에서 한국어 상담 가능한 변호사는 어디서 찾나요?`,
  answer: `한인맵에서 ${cityKo} 한인 변호사를 전문 분야별로 찾을 수 있습니다. 이민, 사업, 가정법 등 다양한 분야의 한국어 상담 변호사가 등록되어 있습니다.`,
},
```

- [ ] **Step 2: Add new common FAQs**

In the `generateCategoryFAQs` function, add to the `commonFaqs` array:

```typescript
{
  question: `${cityKo} 한인 ${categoryNameKo} 추천 기준은?`,
  answer: `한인맵은 Google 평점, 리뷰 수, 커뮤니티 추천 빈도, 정보 정확도를 종합한 신뢰도 점수로 업체를 평가합니다. ${count}곳의 ${categoryNameKo} 중 높은 점수의 업체를 우선 확인하세요.`,
},
{
  question: `${cityKo}에서 평점이 높은 한인 ${categoryNameKo}는?`,
  answer: `한인맵에서 ${cityKo} 한인 ${categoryNameKo}를 별점순으로 정렬하면 평점이 높은 업체를 확인할 수 있습니다. Google 리뷰와 커뮤니티 평가를 함께 참고하세요.`,
},
```

- [ ] **Step 3: Verify and commit**

Run: `npm run build` — confirm no TypeScript errors.

```bash
git add src/components/FAQSection.tsx
git commit -m "feat: add LLM-friendly FAQ templates for GEO optimization"
```

---

## Task 4: Business Auto-Summary + Schema Enhancement

**Files:**
- Create: `src/lib/seo/business-summary.ts`
- Modify: `src/lib/seo/meta.ts` (lines 229-249 for mainEntity, lines 369-479 for areaServed, new speakable builder)
- Modify: `src/app/biz/[slug]/page.tsx` (lines 88-105 for meta, lines 152-180 for schema)
- Modify: `src/app/guides/[slug]/page.tsx` (lines 97-116 for Article schema, line 169 for CSS class, line 195 for FAQ wrapper)
- Modify: `src/app/[state]/[city]/[category]/page.tsx` (lines 387-394 for ItemList slugs)

- [ ] **Step 1: Create business-summary.ts**

Create `src/lib/seo/business-summary.ts`:

```typescript
/**
 * Auto-generate a one-line business summary from DB fields.
 * Used as fallback when Google Places editorialSummary is absent.
 */
export function generateBusinessSummary(params: {
  city: string;
  categoryNameKo: string;
  rating?: number | null;
  reviewCount?: number | null;
  subcategoryNameKo?: string | null;
}): string {
  const { city, categoryNameKo, rating, reviewCount, subcategoryNameKo } = params;
  const cityDisplay = city.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  let summary = `${cityDisplay} 소재 한인 ${categoryNameKo}.`;

  if (rating && reviewCount) {
    summary += ` Google 평점 ${rating.toFixed(1)} (리뷰 ${reviewCount.toLocaleString()}개).`;
  }

  summary += ` 한국어 상담 가능.`;

  if (subcategoryNameKo) {
    summary += ` ${subcategoryNameKo} 전문.`;
  }

  return summary;
}
```

- [ ] **Step 2: Use auto-summary in business page metadata**

In `src/app/biz/[slug]/page.tsx`, import the new helper:

```typescript
import { generateBusinessSummary } from '@/lib/seo/business-summary';
```

In `generateMetadata` (around line 88-105), after getting the business, generate a fallback description if no editorialSummary exists. Add before the `return generateL3Metadata(...)` call:

The auto-summary will be used in the `generateLocalBusinessSchema` call further down — no need to change `generateL3Metadata` since it already builds its own description. The schema `description` field is where the summary matters most for LLMs.

- [ ] **Step 3: Use auto-summary in LocalBusiness JSON-LD**

In the `BusinessPage` component (around line 152-180 in biz/page.tsx), before `generateLocalBusinessSchema`, compute the summary:

```typescript
const autoSummary = !googlePlace?.editorialSummary
  ? generateBusinessSummary({
      city: business.city,
      categoryNameKo: business.primaryCategory.nameKo,
      rating: googlePlace?.rating,
      reviewCount: googlePlace?.userRatingsTotal,
      subcategoryNameKo: business.subcategory?.nameKo,
    })
  : undefined;
```

Then pass it to the schema generator:
```typescript
editorialSummary: googlePlace?.editorialSummary || autoSummary,
```

- [ ] **Step 4: Add `areaServed` to LocalBusiness schema**

In `src/lib/seo/meta.ts`, in `generateLocalBusinessSchema` (around line 406, after the `url` field):

```typescript
// Add areaServed
schema.areaServed = {
  '@type': 'City',
  name: `${business.city}, ${business.state}`,
};
```

This goes right after `schema.url = ...`.

- [ ] **Step 5: Add `mainEntity` to ItemList schema**

In `src/lib/seo/meta.ts`, update `generateItemListSchema` signature and body (lines 229-249):

```typescript
export function generateItemListSchema(
  businesses: Array<{
    name: string;
    slug: string;
    position: number;
  }>,
  pageUrl: string
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    url: pageUrl,
    numberOfItems: businesses.length,
    mainEntity: businesses.map((biz) => ({
      '@type': 'LocalBusiness',
      '@id': `${BASE_URL}/biz/${biz.slug}`,
    })),
    itemListElement: businesses.map((biz) => ({
      '@type': 'ListItem',
      position: biz.position,
      name: biz.name,
      url: `${BASE_URL}/biz/${biz.slug}`,
    })),
  };
}
```

- [ ] **Step 6: Add `speakable` builder for Article schema**

In `src/lib/seo/meta.ts`, add a new exported helper at the end of the file:

```typescript
// ─── Speakable specification for Article pages ──────────────────────

export function buildSpeakableSpec() {
  return {
    '@type': 'SpeakableSpecification',
    cssSelector: ['.guide-summary', '.guide-faq'],
  };
}
```

- [ ] **Step 7: Add speakable to guide page Article JSON-LD**

In `src/app/guides/[slug]/page.tsx`, import the new helper:

```typescript
import { buildBreadcrumbList, buildFAQPageSchema, buildSpeakableSpec } from '@/lib/seo/meta';
```

Update the `articleJsonLd` object (around line 97-116) to include `speakable`:

```typescript
const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: guide.titleKo,
  description: guide.summary,
  datePublished: guide.publishedAt?.toISOString(),
  dateModified: guide.updatedAt.toISOString(),
  author: { '@type': 'Organization', name: '한인맵 HaninMap', url: 'https://www.haninmap.com' },
  publisher: { '@type': 'Organization', name: '한인맵 HaninMap', url: 'https://www.haninmap.com' },
  mainEntityOfPage: `https://www.haninmap.com/guides/${guide.slug}`,
  inLanguage: 'ko',
  speakable: buildSpeakableSpec(),
};
```

- [ ] **Step 8: Add CSS classes for speakable selectors on guide page**

In the guide page JSX (around line 169), add `className="guide-summary"` to the summary paragraph:

```tsx
<p className="text-lg text-gray-600 guide-summary">{guide.summary}</p>
```

Wrap the FAQSection call (around line 195) in a div:

```tsx
{faqs.length > 0 && (
  <div className="guide-faq">
    <FAQSection faqs={faqs} />
  </div>
)}
```

- [ ] **Step 9: Verify and commit**

Run: `npm run build` — confirm no TypeScript errors.

```bash
git add src/lib/seo/business-summary.ts src/lib/seo/meta.ts src/app/biz/[slug]/page.tsx src/app/guides/[slug]/page.tsx
git commit -m "feat: add business auto-summary and Schema.org enhancements for GEO"
```

---

## Task 5: Final Build Verification

**Depends on: Tasks 1-4 all merged.**

- [ ] **Step 1: Full build check**

```bash
npm run build
```

Confirm: no TypeScript errors, no build warnings related to new files.

- [ ] **Step 2: Lint**

```bash
npm run lint
```

Fix any lint issues.

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve lint/build issues from GEO optimization"
```
