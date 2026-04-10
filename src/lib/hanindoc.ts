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

// HaninDoc supported cities (normalized slug)
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
