# List UI Redesign - "빠른 탐색 경험"

## 배경

- RadioKorea(월 190만), HeyKorean(월 48만) 등 경쟁자 UI가 2000년대 수준
- haninmap은 62,570개 업소 데이터 보유, SEO 인프라 완비
- 하지만 트래픽 0에 수렴 — Google이 중복 콘텐츠로 판단 + 서비스 자체 차별화 부족
- 지도 중심 접근은 API 비용 문제로 hanindoc에서 먼저 테스트
- haninmap에서는 **리스트 UI 차별화**로 먼저 반응 테스트

## 목표

**"스크롤만으로 업소를 비교할 수 있는 빠른 탐색 경험"**

### 성공 지표
- 체류 시간 증가 (현재 baseline 측정 후 비교)
- 페이지뷰/세션 증가
- 전화 클릭은 보너스 지표

## 디자인

### 1. 카테고리 허브 페이지 카드 개선 (`/[state]/[city]/[category]`)

**현재**: 업소명 + 주소 기본 카드
**변경**: 정보 밀도 높은 카드

카드에 포함할 정보:
- 업소명 (한/영)
- 평점 + 리뷰 수 (Google Places 데이터 있는 경우)
- 영업시간 상태 (영업중/종료, 저장된 데이터 기반)
- 도시/지역
- [전화] [길찾기] CTA 버튼 (카드에서 바로 액션)
- Google Places 사진 (있는 경우, 기존 photo proxy 활용)

### 2. 정렬/필터 강화

- 정렬: 평점순, 리뷰순 (기본: 평점순)
- 서브카테고리 칩 필터
- 기존 페이지네이션 유지

### 3. 상세 페이지 지도 (`/biz/[slug]`)

- 좌표(lat/lng) 있는 업소: Google Static Maps API 이미지 표시
- 좌표 없는 업소: 주소 텍스트 + Google Maps 링크
- Static Maps: 월 10,000건 무료, 현재 트래픽에서 비용 $0

### 4. 모바일 최적화

- 카드 터치 영역 충분히 크게
- 전화 버튼 눈에 띄게
- 스크롤 성능 최적화

## 하지 않는 것

- 인터랙티브 지도 (JavaScript Maps API) — hanindoc에서 테스트
- 실시간 영업 상태 API 호출 — 저장된 openingHoursText만 사용
- 새로운 데이터 크롤링 — 기존 62,570개 활용
- 검색 기능 추가 — 카테고리/도시 네비게이션으로 충분
- 사용자 위치 기반 정렬 — Phase 2

## 기술 사항

### 데이터 소스
- `Business` 테이블: 이름, 주소, 카테고리
- `GooglePlace` 테이블: 평점, 리뷰수, 영업시간, 사진, 좌표
- 대부분 업소는 GooglePlace 데이터 없음 → 있는 데이터만 표시, 없으면 graceful fallback

### Static Maps API
- URL 형식: `https://maps.googleapis.com/maps/api/staticmap?center={lat},{lng}&zoom=15&size=400x200&markers={lat},{lng}&key={API_KEY}`
- 월 10,000건 무료, 초과 시 $2/1,000건
- 좌표 없는 업소에는 표시하지 않음

### 비용
- API 비용: $0 (현재 트래픽 기준)
- 개발 비용: 시간 투자만

## SEO 관계

- 기존 SSR/ISR 페이지 구조 유지
- 카드 UI 개선은 SEO에 영향 없음 (HTML 구조 유지)
- 체류시간/페이지뷰 증가 → Google Core Web Vitals 간접 개선
- 기존 JSON-LD schema 유지
