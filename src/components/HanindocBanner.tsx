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
