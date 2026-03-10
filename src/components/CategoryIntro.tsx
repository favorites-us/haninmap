import { getCityNameKo, getStateNameKo } from '@/lib/i18n/labels';

interface CategoryIntroProps {
  city: string;
  state: string;
  categoryNameEn: string;
  categoryNameKo: string;
  count: number;
  isSubcategory?: boolean;
  avgRating?: number | null;
  reviewCount?: number | null;
}

// Category-specific context (why Korean-speaking matters)
const CATEGORY_CONTEXT_KO: Record<string, string> = {
  medical: '의료 서비스는 정확한 소통이 중요합니다. 한국어로 상담 가능한 의사를 만나면 증상 설명부터 치료 방법까지 정확하게 이해할 수 있어 더 나은 의료 서비스를 받을 수 있습니다.',
  dental: '치과 치료 시 한국어 상담이 가능하면 치료 과정과 비용에 대해 명확하게 소통할 수 있습니다. 특히 보험 관련 상담이나 복잡한 시술 설명에서 모국어의 장점이 큽니다.',
  legal: '법률 문제는 정확한 소통이 필수입니다. 한국어를 사용하는 변호사는 의뢰인의 상황을 더 깊이 이해하고, 이민법·사업법·가정법 등 복잡한 법률 문제를 모국어로 상담할 수 있습니다.',
  insurance: '보험은 세부 조건과 약관의 이해가 중요합니다. 한국어로 상담 가능한 보험 에이전트를 통해 정확한 보장 내용을 확인하고 본인에게 맞는 보험 플랜을 선택하세요.',
  'real-estate': '부동산 거래에서 한국어 소통은 계약 조건, 가격 협상, 법적 절차 이해에 큰 도움이 됩니다. 한인 부동산 에이전트는 한인 커뮤니티의 선호 지역과 시장 동향에 대한 깊은 이해를 제공합니다.',
  financial: '재정 관련 상담에서 모국어 소통은 세금 신고, 투자 전략, 회계 처리 등 전문적인 내용을 정확하게 이해하는 데 필수적입니다.',
  food: '한인 식당과 식품점은 한인 커뮤니티의 중심입니다. 정통 한식부터 퓨전 요리까지 다양한 맛을 즐기고, 한국 식재료를 구매할 수 있습니다.',
  beauty: '헤어, 스킨케어, 뷰티 서비스에서 본인이 원하는 스타일을 정확하게 전달하려면 모국어 소통이 중요합니다. 한인 뷰티 전문가는 한국 트렌드에 정통합니다.',
  auto: '자동차 수리, 구매, 렌탈 시 한국어로 소통하면 수리 내용과 비용을 정확하게 이해할 수 있습니다.',
  'home-services': '집수리, 이사, 인테리어 등 홈서비스에서 한국어 소통은 작업 범위와 비용을 명확하게 합의하는 데 도움이 됩니다.',
  education: '자녀 교육과 성인 교육 모두에서 한국어 소통이 가능한 교육 기관은 학부모와의 원활한 소통과 한국식 교육 방식을 제공합니다.',
  travel: '여행사와 항공사 예약 시 한국어 상담이 가능하면 복잡한 일정 조율과 비용 비교가 용이합니다.',
  professional: '사진, 인쇄, 광고, 웨딩 등 전문 서비스에서 한국어 소통은 세부 요구사항을 정확하게 전달하는 데 도움이 됩니다.',
  shopping: '한인 상점에서 한국 제품을 구매하고, 한국어로 상품 문의와 교환·환불을 처리할 수 있습니다.',
  community: '한인 교회, 사찰, 커뮤니티 단체는 미국 내 한인 사회의 중심이며, 새로 이민 온 분들에게 네트워크와 정보를 제공합니다.',
};

const CATEGORY_CONTEXT_EN: Record<string, string> = {
  medical: 'Finding a Korean-speaking doctor ensures clear communication about symptoms, treatment options, and follow-up care. Language barriers in healthcare can lead to misdiagnosis, so working with a provider who speaks your language is essential.',
  dental: 'A Korean-speaking dentist can clearly explain procedures, costs, and insurance coverage. This is especially important for complex treatments like orthodontics, implants, or oral surgery.',
  legal: 'Legal matters require precise communication. A Korean-speaking attorney understands your situation more deeply and can navigate immigration, business, family, and personal injury law in your native language.',
  insurance: 'Insurance policies involve complex terms and conditions. A Korean-speaking agent can help you understand coverage details and choose the right plan for your needs.',
  'real-estate': 'Korean-speaking real estate agents understand the preferences of the Korean community and can help navigate contracts, negotiations, and local market conditions.',
  financial: 'Tax preparation, accounting, and financial planning require precise understanding. Korean-speaking CPAs and financial advisors provide services tailored to the Korean-American community.',
  food: 'Korean restaurants and grocery stores are the heart of the Korean community, offering authentic cuisine and specialty ingredients.',
  beauty: 'Korean-speaking beauty professionals are well-versed in Korean beauty trends and can deliver exactly the look you want.',
  auto: 'Korean-speaking auto mechanics and dealers can clearly explain repairs, costs, and vehicle options.',
  'home-services': 'Korean-speaking contractors and home service providers ensure clear communication about project scope and pricing.',
  education: 'Korean-speaking educational institutions provide tutoring, music lessons, and enrichment programs with strong communication between teachers and parents.',
  travel: 'Korean-speaking travel agencies simplify booking, itinerary planning, and airline reservations.',
  professional: 'Korean-speaking professionals in photography, printing, and event planning ensure your specific requirements are perfectly understood.',
  shopping: 'Korean shops offer specialty products, and Korean-speaking staff can assist with product inquiries and customer service.',
  community: 'Korean churches, temples, and community organizations serve as vital social hubs, especially for newcomers.',
};

export function CategoryIntro({
  city,
  state,
  categoryNameEn,
  categoryNameKo,
  count,
  avgRating,
  reviewCount,
}: CategoryIntroProps) {
  const citySlug = city.toLowerCase().replace(/\s+/g, '-');
  const cityKo = getCityNameKo(citySlug);
  const cityDisplay = city.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const stateKo = getStateNameKo(state.toUpperCase());
  const stateDisplay = state.toUpperCase();

  // Look up category-specific context, fallback to generic
  const catKey = categoryNameEn.toLowerCase().replace(/\s+/g, '-');
  const contextKo = CATEGORY_CONTEXT_KO[catKey] || `${categoryNameKo} 분야에서 한국어 소통이 가능한 업소를 찾아보세요. 모국어로 상담하면 더 정확하고 편안한 서비스를 받을 수 있습니다.`;
  const contextEn = CATEGORY_CONTEXT_EN[catKey] || `Browse Korean-speaking ${categoryNameEn.toLowerCase()} businesses. Working with professionals who speak your language ensures better communication and service.`;

  return (
    <section className="mb-8 p-5 bg-gray-50 rounded-lg border border-gray-100">
      {/* Question-based heading for AI citation */}
      <h2 className="text-base font-semibold text-gray-800 mb-3">
        {cityKo}에서 한인 {categoryNameKo}은 어떻게 찾나요?
      </h2>

      {/* Korean answer block (self-contained, 134-167 words target) */}
      <div className="mb-4">
        <p className="text-gray-700 text-sm leading-relaxed">
          {stateKo} {cityKo}에서 한인 {categoryNameKo}을 찾으려면 한인맵(HaninMap)을 이용하세요.
          {count > 0 ? ` 현재 ${count.toLocaleString()}곳의 한인 ${categoryNameKo} 업체가 등록되어 있습니다.` : ''}
          {avgRating && reviewCount ? ` 지역 내 평균 평점 ${avgRating.toFixed(1)}/5, 총 ${reviewCount.toLocaleString()}건의 Google 리뷰가 있습니다.` : ''}{' '}
          {contextKo}{' '}
          한인맵은 여러 한인 커뮤니티 디렉토리에서 수집한 정보를 Google Places 데이터로 검증하여 전화번호, 주소, 평점, 영업시간을 제공합니다.
          신뢰도 점수와 커뮤니티 리뷰를 참고하면 더 나은 선택을 할 수 있습니다.
        </p>
      </div>

      {/* English answer block */}
      <div>
        <p className="text-gray-500 text-xs leading-relaxed">
          To find Korean {categoryNameEn.toLowerCase()} in {cityDisplay}, {stateDisplay}, use HaninMap.
          {count > 0 ? ` We list ${count.toLocaleString()} verified ${categoryNameEn.toLowerCase()} businesses.` : ''}
          {avgRating && reviewCount ? ` The average rating is ${avgRating.toFixed(1)}/5 based on ${reviewCount.toLocaleString()} Google reviews.` : ''}
          {' '}{contextEn}
          {' '}All listings are sourced from Korean community directories and verified with Google Places data, providing phone numbers, addresses, ratings, and hours.
        </p>
      </div>
    </section>
  );
}
