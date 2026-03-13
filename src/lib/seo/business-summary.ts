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
