# Google AdSense + HaninDoc 의료 크로스링크 설계

**Date**: 2026-04-09
**Goal**: Google AdSense Auto Ads를 삽입하고, 의료 카테고리에서 HaninDoc(hanindoc.com) 지도 기반 탐색으로 연결하는 크로스링크를 추가한다.

## Feature 1: Google AdSense Auto Ads

### 구현 방식

Google Auto Ads — `<head>`에 AdSense 스크립트를 삽입하면 Google이 페이지를 분석하여 최적 위치에 자동 광고 배치.

### 변경 사항

1. **`src/components/ads/AdSense.tsx`** (신규)
   - Client Component (`'use client'`)
   - Next.js `Script` 컴포넌트로 AdSense 스크립트 로드 (`strategy="afterInteractive"`)
   - Publisher ID: `ca-pub-4866951344575541`
   - 환경변수 `NEXT_PUBLIC_ADSENSE_PUB_ID`로 관리, 값이 없으면 렌더링하지 않음

2. **`src/app/layout.tsx`**
   - `<AdSense />` 컴포넌트를 `<GoogleAnalytics />` 옆에 추가

### AdSense 스크립트

```html
<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4866951344575541" crossorigin="anonymous"></script>
```

---

## Feature 2: HaninDoc 의료 크로스링크

### Context

- HaninDoc (`www.hanindoc.com`): 한인 의료 디렉토리, 지도 기반 탐색
- 현재 지원 도시: los-angeles, koreatown, irvine, fullerton, buena-park (CA만)
- HaninMap의 의료 카테고리 업체 중 해당 도시에 있는 업체에 대해 HaninDoc 링크 제공

### HaninDoc URL 패턴

| 유형 | URL | 예시 |
|------|-----|------|
| 병원 상세 | `/hospital/[slug]` | `/hospital/kim-dental-irvine` |
| 카테고리 리스트 | `/[city]/[category]` | `/los-angeles/dental` |
| 전체 리스트 | `/[city]/all` | `/koreatown/all` |

### 표시 위치

#### A. 업체 상세 페이지 (`/biz/[slug]`)

**조건:** 업체가 의료 카테고리이고, HaninDoc 지원 도시에 위치하며, HaninDoc에 해당 업체가 존재할 때

**링크 대상:**
- HaninDoc slug를 알면 → `hanindoc.com/hospital/[hanindoc-slug]`
- 모르면 → `hanindoc.com/[city]/[mapped-category]` (카테고리 리스트로 폴백)

**UI:** 컴팩트 배너, 업체 상세 콘텐츠 내 적절한 위치 (예: CTA 섹션 근처)
```
[🗺] 한인닥에서 지도로 보기 →
```
스타일: `bg-teal-50 text-teal-700 rounded-lg p-3`, 새 탭 열림

#### B. 카테고리 리스팅 페이지 (`/[state]/[city]/[category]`)

**조건:** URL의 `category` 파라미터가 카테고리 매핑에 존재하고, HaninDoc 지원 도시일 때. `category`는 primary(`medical`, `dental`) 또는 subcategory slug 모두 가능 — 매핑 테이블에서 직접 lookup.

**링크 대상:** `hanindoc.com/[city]/[mapped-category]`

**UI:** 리스트 상단에 배너
```
[🗺] 한인닥에서 {cityKo} {categoryKo} 지도로 탐색하기 →
```
스타일: 동일한 teal 배너, 새 탭 열림

### 카테고리 매핑 (HaninMap → HaninDoc)

의료 관련 카테고리만 매핑. 매핑이 없는 카테고리는 배너 미표시.

```ts
const HANINMAP_TO_HANINDOC_CATEGORY: Record<string, string> = {
  // Primary
  'medical': 'primary_care',
  'dental': 'dental',
  // Subcategories
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
  // 나머지 의료 하위 카테고리
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
```

### 도시 매핑 (HaninMap → HaninDoc)

DB의 `Business.city` 필드는 원본 형태로 저장됨 (예: `"Los Angeles"`, `"Buena Park"`). 헬퍼 함수에서 **정규화 후 매핑**한다: `city.toLowerCase().replace(/\s+/g, '-')` → slug 형태로 변환 후 lookup.

```ts
const HANINDOC_SUPPORTED_CITIES: Record<string, string> = {
  'los-angeles': 'los-angeles',
  'koreatown': 'koreatown',
  'irvine': 'irvine',
  'fullerton': 'fullerton',
  'buena-park': 'buena-park',
};

function normalizeCity(city: string): string {
  return city.toLowerCase().replace(/\s+/g, '-');
}

function getHanindocCity(city: string): string | null {
  return HANINDOC_SUPPORTED_CITIES[normalizeCity(city)] ?? null;
}
```

매핑에 없는 도시 → 배너 미표시.

**Koreatown 참고:** HaninMap DB에 `city`가 `"Koreatown"`으로 저장된 업체에만 적용. `city`가 `"Los Angeles"`인 코리아타운 업체는 LA로 매핑됨 — HaninDoc에서도 LA 리스트에 포함되므로 문제없음.

**국제 업체:** 캐나다(`/canada/...`), 호주(`/australia/...`) 경로는 HaninDoc 미지원이므로 대상에서 제외.

### HaninDoc Slug 조회 (업체 상세용)

업체 상세 페이지에서 HaninDoc의 개별 병원 페이지로 링크하려면 HaninDoc slug가 필요하다.

**방법:** 매핑 스크립트로 사전 생성

1. 스크립트 `scripts/data/sync-hanindoc-slugs.ts` 작성
2. HaninDoc Supabase `businesses` 테이블에서 slug와 식별 정보 (phone, name) 조회
3. HaninMap `Business` 테이블과 매칭 (phone → name 순)
4. 매칭 결과를 HaninMap DB에 저장 (새 필드 또는 테이블)

**저장 방식:** `GooglePlace.sourceId`에 이미 HaninDoc UUID가 있는 업체가 있으므로, 새로운 nullable 필드 `Business.hanindocSlug String?`을 추가하여 slug를 저장한다. 스키마 변경 후 `npx prisma db push`로 적용.

**조회 흐름 (런타임):**
1. `business.hanindocSlug` 있으면 → `hanindoc.com/hospital/{hanindocSlug}` 링크
2. 없으면 → `hanindoc.com/{city}/{category}` 카테고리 리스트로 폴백
3. 도시가 HaninDoc 미지원 → 배너 미표시

### 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `prisma/schema.prisma` | Business 모델에 `hanindocSlug String?` 필드 추가 |
| `scripts/data/sync-hanindoc-slugs.ts` | HaninDoc slug 동기화 스크립트 (신규) |
| `src/lib/hanindoc.ts` | 카테고리/도시 매핑 헬퍼 (신규) |
| `src/components/HanindocBanner.tsx` | 크로스링크 배너 컴포넌트 (신규) |
| `src/components/ads/AdSense.tsx` | AdSense 스크립트 컴포넌트 (신규) |
| `src/app/layout.tsx` | AdSense 컴포넌트 추가 |
| `src/app/biz/[slug]/page.tsx` | HanindocBanner 추가 (의료 업체일 때) |
| `src/app/[state]/[city]/[category]/page.tsx` | HanindocBanner 추가 (의료 카테고리일 때) |

### Edge Cases

- **HaninDoc에 없는 업체:** 카테고리 리스트 페이지로 폴백
- **HaninDoc 미지원 도시:** 배너 미표시
- **비의료 카테고리:** 배너 미표시 (법률, 보험 등)
- **국제 업체 (캐나다/호주):** HaninDoc 미지원 → 배너 미표시
- **AdSense Publisher ID 미설정:** 컴포넌트가 null 반환, 아무 영향 없음
