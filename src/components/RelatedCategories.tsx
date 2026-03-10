import Link from 'next/link';

const RELATED_CATEGORIES: Record<string, string[]> = {
  medical: ['dental', 'insurance'],
  dental: ['medical', 'insurance'],
  legal: ['real-estate', 'financial'],
  insurance: ['medical', 'auto'],
  'real-estate': ['legal', 'home-services'],
  food: ['shopping'],
  beauty: ['shopping'],
  auto: ['insurance'],
  'home-services': ['real-estate'],
  education: ['community'],
  travel: ['food'],
  professional: ['legal', 'financial'],
  shopping: ['food', 'beauty'],
  community: ['education'],
  financial: ['legal', 'insurance'],
};

// Category slug -> Korean name mapping
const CATEGORY_NAME_KO: Record<string, string> = {
  medical: '병원',
  dental: '치과',
  legal: '법률',
  insurance: '보험',
  'real-estate': '부동산',
  food: '식당',
  beauty: '뷰티',
  auto: '자동차',
  'home-services': '주택서비스',
  education: '교육',
  travel: '여행',
  professional: '전문서비스',
  shopping: '쇼핑',
  community: '커뮤니티',
  financial: '금융',
};

interface RelatedCategoriesProps {
  currentCategory: string;
  state: string;
  city: string;
}

export function RelatedCategories({ currentCategory, state, city }: RelatedCategoriesProps) {
  const related = RELATED_CATEGORIES[currentCategory];
  if (!related || related.length === 0) return null;

  return (
    <nav className="my-6" aria-label="Related categories">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm text-gray-500">관련 카테고리:</span>
        {related.map((slug) => (
          <Link
            key={slug}
            href={`/${state}/${city}/${slug}`}
            className="px-3 py-1 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
          >
            {CATEGORY_NAME_KO[slug] || slug}
          </Link>
        ))}
      </div>
    </nav>
  );
}
