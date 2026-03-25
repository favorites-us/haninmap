# 업체 상세 페이지 카테고리 TOP 10 순위 표시 설계

**Date**: 2026-03-24
**Goal**: 업체 상세 페이지 하단의 RelatedBusinesses 컴포넌트를 TrustScore 기반 지역+카테고리 TOP 10 순위 리스트로 개선하여 사용자에게 의미 있는 비교 정보를 제공한다.

## Context

- GA4 28일 데이터: 일평균 7.9명, 업체 상세 페이지 체류시간이 높음 (일부 500s+)
- 특정 업체를 검색해서 유입되는 사용자가 많으나, 관련 업체 탐색 유도가 약함
- 기존 `RelatedBusinesses` 컴포넌트는 같은 도시/카테고리에서 `qualityScore` 순 4개를 카드로 보여줌 — 순위 표시 없고 정보량 부족
- TrustScore 시스템이 이미 존재 (0-100, communityScore + externalScore + engagementScore + reviewScore)
- TrustScore 테이블에 카테고리별 `rank`가 저장되어 있으나 도시 단위 순위는 없음

## Prerequisites: Schema Migration

현재 `TrustScore.businessId`는 `String`이고 `Business.id`는 `Int`이며, 두 테이블 간 Prisma relation이 없다. 쿼리에서 relation-based include/orderBy를 사용하려면 먼저 스키마를 변경해야 한다.

**변경 사항:**

1. `Business` 모델에 `trustScore TrustScore?` 관계 필드 추가
2. `TrustScore` 모델에 `business Business @relation(fields: [businessId], references: [id])` 추가
3. `TrustScore.businessId`를 `String`에서 `Int`로 변경
4. 복합 인덱스 `@@index([primaryCategoryId, city, state])` 를 `Business` 모델에 추가

**마이그레이션 순서:**
1. 기존 TrustScore 데이터의 businessId를 Int 호환 확인 (현재 String이지만 값은 숫자)
2. Prisma 스키마 변경 후 `npm run db:migrate` 실행
3. `calculate-trust-scores.ts`에서 `businessId: bizId` 부분이 Int로 변경되므로 `String(biz.id)` → `biz.id`로 수정

## Design

### 1. 데이터 쿼리 로직

기존 `RelatedBusinesses`의 쿼리를 TrustScore relation JOIN 방식으로 변경한다.

**조회 전략 (도시 우선 → 주 확장):**

1. 같은 **city + state + primaryCategoryId**에서 TrustScore를 JOIN하여 `totalScore DESC` 순으로 최대 10개 조회
2. 결과가 10개 미만이면 같은 **state + primaryCategoryId** (city 제한 없이)에서 추가 조회하여 10개를 채움
3. 현재 보고 있는 업체(`currentId`)는 리스트에서 제외
4. 동점 시 tie-breaking: `totalScore DESC, qualityScore DESC, id ASC`

**현재 업체 순위 산정:**
- 같은 city + category 범위에서 현재 업체(`currentId` 제외)보다 totalScore가 높은 업체 수를 COUNT하여 순위를 계산
- TrustScore가 없는 업체는 "순위 미산정"으로 표시

**Prisma 쿼리 구조:**

```ts
// Step 1: 도시 범위 조회
const cityResults = await prisma.business.findMany({
  where: {
    primaryCategoryId: categoryId,
    city, state,
    id: { not: currentId },
    trustScore: { isNot: null },
  },
  include: {
    googlePlace: { select: { rating: true, userRatingsTotal: true } },
    trustScore: { select: { totalScore: true } },
  },
  orderBy: [
    { trustScore: { totalScore: 'desc' } },
    { qualityScore: 'desc' },
    { id: 'asc' },
  ],
  take: 10,
});

// Step 2: 부족하면 주 범위로 확장
let stateExpanded = false;
let stateResults: typeof cityResults = [];
if (cityResults.length < 10) {
  stateExpanded = true;
  const excludeIds = [currentId, ...cityResults.map(b => b.id)];
  stateResults = await prisma.business.findMany({
    where: {
      primaryCategoryId: categoryId,
      state,
      id: { notIn: excludeIds },
      trustScore: { isNot: null },
    },
    // same includes/orderBy as above
    take: 10 - cityResults.length,
  });
}

// 현재 업체 순위 산정 (도시 범위 기준)
const currentTrustScore = await prisma.trustScore.findUnique({
  where: { businessId: currentId },
  select: { totalScore: true },
});
let currentRank: number | null = null;
if (currentTrustScore) {
  const higherCount = await prisma.business.count({
    where: {
      primaryCategoryId: categoryId,
      city, state,
      id: { not: currentId },
      trustScore: { totalScore: { gt: currentTrustScore.totalScore } },
    },
  });
  currentRank = higherCount + 1;
}
```

### 2. 컴포넌트 Props 변경

```ts
// 기존
interface RelatedBusinessesProps {
  currentId: number;
  categoryId: number;
  city: string;
  state: string;
}

// 변경
interface RelatedBusinessesProps {
  currentId: number;
  categoryId: number;
  city: string;
  state: string;
  categoryNameKo: string;  // 추가: 제목 표시용
}
```

부모 페이지(`BusinessPage`)에서 `categoryNameKo={business.primaryCategory.nameKo}`를 추가로 전달한다.

### 3. UI 변경

**제목:**
- 도시 범위 충분 (10개 이상): "{cityDisplay} {categoryNameKo} TOP 10"
  - 예: "Flushing 내과 TOP 10"
- 주 범위 확장 시 (도시 결과 < 10): "{stateDisplay} {categoryNameKo} TOP 10"
  - 예: "NY 내과 TOP 10"
- `cityDisplay`: `toTitleCase(city)` (기존 함수 재사용)
- `stateDisplay`: `state.toUpperCase()` (DB에 저장된 약어 그대로 사용 — "CA", "NY" 등. 한인 사용자에게 익숙한 형태)

**현재 업체 순위 배너:**
리스트 상단에 한 줄 표시:
- TrustScore 있을 때: "현재 업체는 {scope}에서 {rank}위입니다"
- TrustScore 없을 때: "이 업체는 아직 순위가 산정되지 않았습니다"

배너 스타일: `bg-blue-50 text-blue-700 rounded-lg p-3 text-sm`

**리스트 레이아웃:**
기존 2열 그리드 카드 → 번호 매긴 세로 리스트로 변경.

각 항목 구성:
```
[순위번호] 업체명 (한국어)                    신뢰점수 XX
           English Name
           ★ 4.5 (120개 리뷰)               →
```

- 순위 번호: 1~10, 큰 폰트/bold로 좌측 표시
- 업체명: 한국어 primary, 영어 secondary (기존 패턴 유지)
- Google 평점 + 리뷰 수: 있으면 표시, 없으면 생략
- TrustScore: 우측에 작은 뱃지로 표시 (기존 `TrustScoreDetail`의 색상 체계 활용)
- 전체 행이 Link로 클릭 가능 (기존 패턴 유지)

**스타일:**
- 각 항목: `flex items-center gap-4 p-4 border-b border-gray-100 hover:bg-gray-50 transition-colors`
- 순위 번호: `text-2xl font-bold text-gray-300` (1-3위는 `text-blue-600`으로 강조)
- TrustScore 뱃지: 기존 색상 체계 — 80+ green, 60+ yellow, 나머지 gray

### 4. 변경 파일 목록

| 파일 | 변경 내용 |
|------|----------|
| `prisma/schema.prisma` | Business ↔ TrustScore relation 추가, TrustScore.businessId를 Int로 변경, 복합 인덱스 추가 |
| `scripts/ops/calculate-trust-scores.ts` | businessId 타입 String → Int 대응 수정 |
| `src/app/biz/[slug]/page.tsx` | `RelatedBusinesses` 컴포넌트 전체 교체, props에 `categoryNameKo` 추가 |

### 5. 성능 고려사항

- TrustScore JOIN 쿼리는 `primaryCategoryId + city + state` 인덱스를 활용
- 최악 2회 쿼리 (도시 → 주 확장) + 1회 COUNT 쿼리 = 최대 3회
- 기존도 1회 쿼리였으므로 최대 2회 추가 — ISR 7일 캐시(`revalidate = 604800`)로 런타임 영향 없음

### 6. Edge Cases

- **TrustScore가 없는 업체가 대부분인 도시**: 리스트가 짧아질 수 있음 → 최소 표시 기준 없이, 있는 만큼만 보여줌
- **현재 업체에 TrustScore 없음**: 순위 배너에 "순위 미산정" 표시, 리스트는 정상 노출
- **같은 주에도 10개 미만**: 있는 만큼만 표시 (빈 상태 메시지 불필요)
- **결과 0건**: 기존과 동일하게 `return null` — 섹션 자체를 렌더링하지 않음
- **국제 업체 (캐나다/호주)**: city + state(region) 동일 로직 적용 가능 — 기존 데이터 구조 동일
- **동점 업체**: `totalScore` 동점 시 `qualityScore DESC, id ASC`로 tie-break — ISR 재빌드 간 순위 일관성 보장
- **업체명 표시**: 기존 상세 페이지 패턴과 동일하게 한국어 우선 (`nameKo` primary, `nameEn` secondary). 기존 RelatedBusinesses는 영어 우선이었으나 사이트 전체 톤과 일치하도록 한국어 우선으로 의도적 변경
