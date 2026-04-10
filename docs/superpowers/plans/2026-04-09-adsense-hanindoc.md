# AdSense + HaninDoc 크로스링크 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Google AdSense Auto Ads를 삽입하고, 의료 카테고리 페이지에서 HaninDoc 지도 기반 탐색으로 연결하는 크로스링크를 추가한다.

**Architecture:** AdSense는 layout에 Script 컴포넌트 1개 추가. HaninDoc 연동은 매핑 헬퍼 + 배너 컴포넌트로 구성하고, 업체 상세와 카테고리 리스팅 페이지에 조건부 렌더링. HaninDoc slug는 별도 동기화 스크립트로 사전 매칭.

**Tech Stack:** Next.js 14 App Router, Prisma ORM, TypeScript, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-09-adsense-hanindoc-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/components/ads/AdSense.tsx` | Create | AdSense 스크립트 로더 (Client Component) |
| `src/app/layout.tsx` | Modify | AdSense 컴포넌트 추가 |
| `src/lib/hanindoc.ts` | Create | 카테고리/도시 매핑 + URL 빌더 헬퍼 |
| `src/components/HanindocBanner.tsx` | Create | 크로스링크 배너 UI (Server Component) |
| `prisma/schema.prisma` | Modify | Business에 `hanindocSlug` 필드 추가 |
| `scripts/data/sync-hanindoc-slugs.ts` | Create | HaninDoc slug 동기화 스크립트 |
| `src/app/biz/[slug]/page.tsx` | Modify | 업체 상세에 HanindocBanner 추가 |
| `src/app/[state]/[city]/[category]/page.tsx` | Modify | 카테고리 리스팅에 HanindocBanner 추가 |

---

## Task 1: AdSense Auto Ads 컴포넌트 + Layout 추가

**Files:**
- Create: `src/components/ads/AdSense.tsx`
- Modify: `src/app/layout.tsx:45`

- [ ] **Step 1: Create AdSense component**

Create `src/components/ads/AdSense.tsx`:

```tsx
'use client';

import Script from 'next/script';

const ADSENSE_PUB_ID = process.env.NEXT_PUBLIC_ADSENSE_PUB_ID;

export function AdSense() {
  if (!ADSENSE_PUB_ID) return null;

  return (
    <Script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_PUB_ID}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  );
}
```

- [ ] **Step 2: Add AdSense to layout**

In `src/app/layout.tsx`, add import at line 4 (after GoogleAnalytics import):

```tsx
import { AdSense } from '@/components/ads/AdSense';
```

Add `<AdSense />` after `<GoogleAnalytics />` at line 45:

```tsx
        <GoogleAnalytics />
        <AdSense />
```

- [ ] **Step 3: Add env variable**

Add to `.env`:
```
NEXT_PUBLIC_ADSENSE_PUB_ID=ca-pub-4866951344575541
```

- [ ] **Step 4: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/components/ads/AdSense.tsx src/app/layout.tsx
git commit -m "feat: add Google AdSense Auto Ads

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: HaninDoc 매핑 헬퍼 라이브러리

**Files:**
- Create: `src/lib/hanindoc.ts`

- [ ] **Step 1: Create hanindoc helper**

Create `src/lib/hanindoc.ts` with category mapping, city mapping, and URL builder:

```ts
/**
 * HaninDoc (hanindoc.com) cross-link helpers.
 * Maps HaninMap categories/cities to HaninDoc equivalents
 * and builds URLs for cross-linking.
 */

const HANINDOC_BASE = 'https://www.hanindoc.com';

// HaninMap category slug → HaninDoc category code
const CATEGORY_MAP: Record<string, string> = {
  // Primary categories
  'medical': 'primary_care',
  'dental': 'dental',
  // Medical subcategories
  'internal-medicine': 'primary_care',
  'obgyn': 'womens_health',
  'pediatrics': 'pediatrics',
  'dermatology': 'skin_aesthetic',
  'ophthalmology': 'eye_vision',
  'orthopedics': 'musculoskeletal',
  'psychiatry': 'mental_health',
  'korean-medicine': 'acupuncture',
  'plastic-surgery': 'skin_aesthetic',
  'pain-management': 'musculoskeletal',
  'rehabilitation': 'musculoskeletal',
  'optometrist': 'eye_vision',
  'general-hospital': 'others',
  'pharmacy': 'others',
  'neurosurgery': 'others',
  'urology': 'others',
  'cardiology': 'primary_care',
  'gastroenterology': 'primary_care',
  'general-surgery': 'others',
  'oncology': 'others',
  'nephrology': 'others',
  'pulmonology': 'primary_care',
  'endocrinology': 'primary_care',
  'rheumatology': 'others',
  'allergy': 'primary_care',
  'podiatry': 'others',
  'diagnostics': 'others',
  'ent': 'others',
  // Dental subcategories
  'general-dentist': 'dental',
  'orthodontist': 'dental',
  'pediatric-dentist': 'dental',
  'dental-implants': 'dental',
  'prosthodontist': 'dental',
  'periodontist': 'dental',
  'dental-lab': 'dental',
};

// HaninDoc supported cities (normalized slug → hanindoc slug)
const SUPPORTED_CITIES = new Set([
  'los-angeles',
  'koreatown',
  'irvine',
  'fullerton',
  'buena-park',
]);

function normalizeCity(city: string): string {
  return city.toLowerCase().replace(/\s+/g, '-');
}

/** Get HaninDoc category code for a HaninMap category slug, or null if not medical */
export function getHanindocCategory(categorySlug: string): string | null {
  return CATEGORY_MAP[categorySlug] ?? null;
}

/** Get HaninDoc city slug if the city is supported, or null */
export function getHanindocCity(city: string): string | null {
  const normalized = normalizeCity(city);
  return SUPPORTED_CITIES.has(normalized) ? normalized : null;
}

/** Build HaninDoc hospital detail URL */
export function hanindocHospitalUrl(slug: string): string {
  return `${HANINDOC_BASE}/hospital/${slug}`;
}

/** Build HaninDoc category listing URL */
export function hanindocCategoryUrl(city: string, category: string): string {
  return `${HANINDOC_BASE}/${city}/${category}`;
}

/** Check if a category slug is medical (has a HaninDoc mapping) */
export function isMedicalCategory(categorySlug: string): boolean {
  return categorySlug in CATEGORY_MAP;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/hanindoc.ts
git commit -m "feat: add HaninDoc category/city mapping helpers

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: HanindocBanner 컴포넌트

**Files:**
- Create: `src/components/HanindocBanner.tsx`

- [ ] **Step 1: Create banner component**

Create `src/components/HanindocBanner.tsx`:

```tsx
import {
  getHanindocCity,
  getHanindocCategory,
  hanindocHospitalUrl,
  hanindocCategoryUrl,
} from '@/lib/hanindoc';

interface HanindocBannerProps {
  /** HaninMap category slug (primary or sub) */
  categorySlug: string;
  /** Business city from DB (e.g. "Los Angeles", "Irvine") */
  city: string;
  /** HaninDoc slug for direct hospital link (optional) */
  hanindocSlug?: string | null;
  /** Korean display name for category (for listing page label) */
  categoryNameKo?: string;
}

export function HanindocBanner({
  categorySlug,
  city,
  hanindocSlug,
  categoryNameKo,
}: HanindocBannerProps) {
  const hanindocCity = getHanindocCity(city);
  const hanindocCategory = getHanindocCategory(categorySlug);

  // Don't render if city or category not supported
  if (!hanindocCity || !hanindocCategory) return null;

  // Build URL: direct hospital link if slug available, otherwise category listing
  const url = hanindocSlug
    ? hanindocHospitalUrl(hanindocSlug)
    : hanindocCategoryUrl(hanindocCity, hanindocCategory);

  // Label text
  const cityDisplay = city.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const label = hanindocSlug
    ? '한인닥에서 지도로 보기'
    : categoryNameKo
      ? `한인닥에서 ${cityDisplay} ${categoryNameKo} 지도로 탐색하기`
      : '한인닥에서 지도로 탐색하기';

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 bg-teal-50 text-teal-700 rounded-lg p-3 text-sm hover:bg-teal-100 transition-colors"
    >
      <span>🗺 {label}</span>
      <span aria-hidden="true">→</span>
    </a>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/HanindocBanner.tsx
git commit -m "feat: add HanindocBanner cross-link component

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Schema 변경 + HaninDoc Slug 동기화 스크립트

**Files:**
- Modify: `prisma/schema.prisma:11-45`
- Create: `scripts/data/sync-hanindoc-slugs.ts`

- [ ] **Step 1: Add hanindocSlug field to Business model**

In `prisma/schema.prisma`, add after `slug` field (line ~29):

```prisma
  hanindocSlug      String?
```

- [ ] **Step 2: Apply schema change**

```bash
npx prisma db push
```

- [ ] **Step 3: Create sync script**

Create `scripts/data/sync-hanindoc-slugs.ts`:

```ts
/**
 * Sync HaninDoc slugs into HaninMap Business records.
 * Matches by: GooglePlace.sourceId (HaninDoc UUID) → phone → name.
 *
 * Usage: npx tsx scripts/data/sync-hanindoc-slugs.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HANINDOC_URL = 'https://ltabbyecozsxcqxqqvcq.supabase.co';
const HANINDOC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0YWJieWVjb3pzeGNxeHFxdmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NDIyNTMsImV4cCI6MjA4MzQxODI1M30.uTopD9pRXPd0WBgoyMyfmBGrrHh0y-Lype7RY--AH-4';

interface HanindocBiz {
  id: string;
  slug: string;
  name_ko: string;
  name_en: string | null;
  phone_formatted: string | null;
  phone_international: string | null;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

async function main() {
  console.log('=== HaninDoc Slug Sync ===\n');

  // 1. Fetch all HaninDoc businesses with slugs
  console.log('Fetching HaninDoc businesses...');
  const res = await fetch(
    `${HANINDOC_URL}/rest/v1/businesses?select=id,slug,name_ko,name_en,phone_formatted,phone_international&slug=not.is.null`,
    { headers: { apikey: HANINDOC_KEY, Authorization: `Bearer ${HANINDOC_KEY}` } },
  );
  if (!res.ok) throw new Error(`HaninDoc fetch failed: ${res.status}`);
  const hanindocBizs: HanindocBiz[] = await res.json();
  console.log(`  Loaded ${hanindocBizs.length} HaninDoc businesses with slugs.`);

  // 2. Build lookup maps
  const phoneMap = new Map<string, HanindocBiz>();
  const nameMap = new Map<string, HanindocBiz>();
  for (const biz of hanindocBizs) {
    const phone = normalizePhone(biz.phone_formatted) || normalizePhone(biz.phone_international);
    if (phone) phoneMap.set(phone, biz);
    if (biz.name_ko) nameMap.set(biz.name_ko.trim().toLowerCase(), biz);
  }

  // 3. Load HaninMap medical businesses (medical + dental primary categories)
  const medicalCategories = await prisma.category.findMany({
    where: {
      OR: [
        { slug: 'medical' },
        { slug: 'dental' },
        { parent: { slug: { in: ['medical', 'dental'] } } },
      ],
    },
    select: { id: true },
  });
  const categoryIds = medicalCategories.map(c => c.id);

  const businesses = await prisma.business.findMany({
    where: { primaryCategoryId: { in: categoryIds } },
    select: {
      id: true,
      nameKo: true,
      phoneE164: true,
      phoneRaw: true,
      googlePlace: { select: { sourceId: true } },
    },
  });
  console.log(`  Loaded ${businesses.length} HaninMap medical businesses.`);

  // 4. Match and update
  let matched = 0;
  let bySourceId = 0;
  let byPhone = 0;
  let byName = 0;

  for (const biz of businesses) {
    let hanindoc: HanindocBiz | undefined;

    // Match by sourceId (HaninDoc UUID)
    if (biz.googlePlace?.sourceId) {
      hanindoc = hanindocBizs.find(h => h.id === biz.googlePlace!.sourceId);
      if (hanindoc) bySourceId++;
    }

    // Match by phone
    if (!hanindoc) {
      const phone = normalizePhone(biz.phoneE164) || normalizePhone(biz.phoneRaw);
      if (phone) {
        hanindoc = phoneMap.get(phone);
        if (hanindoc) byPhone++;
      }
    }

    // Match by Korean name
    if (!hanindoc && biz.nameKo) {
      hanindoc = nameMap.get(biz.nameKo.trim().toLowerCase());
      if (hanindoc) byName++;
    }

    if (hanindoc) {
      await prisma.business.update({
        where: { id: biz.id },
        data: { hanindocSlug: hanindoc.slug },
      });
      matched++;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`  Total matched: ${matched}/${businesses.length}`);
  console.log(`  By sourceId: ${bySourceId}`);
  console.log(`  By phone: ${byPhone}`);
  console.log(`  By name: ${byName}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Sync failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
```

- [ ] **Step 4: Run sync script**

```bash
set -a && source .env && set +a && npx tsx scripts/data/sync-hanindoc-slugs.ts
```

Expected: Script completes, shows match count.

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma scripts/data/sync-hanindoc-slugs.ts
git commit -m "feat: add hanindocSlug field and sync script

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: 업체 상세 페이지에 HanindocBanner 추가

**Files:**
- Modify: `src/app/biz/[slug]/page.tsx:57-86,374-383`

- [ ] **Step 1: Update getBusiness to include hanindocSlug**

`getBusiness` uses `findUnique` with `include` — Prisma returns all scalar fields by default, so `hanindocSlug` will be included automatically. No query change needed.

- [ ] **Step 2: Add import and banner to page**

In `src/app/biz/[slug]/page.tsx`, add import at the top (after existing component imports):

```tsx
import { HanindocBanner } from '@/components/HanindocBanner';
```

Add the banner after `<BusinessCTA>` (around line 383), before `<FAQSection>`:

```tsx
        {/* HaninDoc Cross-link */}
        <div className="mb-8">
          <HanindocBanner
            categorySlug={business.primaryCategory.slug}
            city={business.city}
            hanindocSlug={business.hanindocSlug}
          />
        </div>
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add "src/app/biz/[slug]/page.tsx"
git commit -m "feat: add HaninDoc banner to business detail page

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 카테고리 리스팅 페이지에 HanindocBanner 추가

**Files:**
- Modify: `src/app/[state]/[city]/[category]/page.tsx:442-453`

- [ ] **Step 1: Add import and banner**

In `src/app/[state]/[city]/[category]/page.tsx`, add import:

```tsx
import { HanindocBanner } from '@/components/HanindocBanner';
```

Add the banner after the `<header>` section (after line 453, before `<CityFilter>`):

```tsx
        {/* HaninDoc Cross-link */}
        <div className="mb-4">
          <HanindocBanner
            categorySlug={category}
            city={city}
            categoryNameKo={categoryInfo.nameKo}
          />
        </div>
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add "src/app/[state]/[city]/[category]/page.tsx"
git commit -m "feat: add HaninDoc banner to category listing page

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>"
```
