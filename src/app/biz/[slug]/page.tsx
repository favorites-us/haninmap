import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/lib/db/prisma';
import { FAQSection, generateBusinessFAQs } from '@/components/FAQSection';
import { BusinessCTA } from '@/components/BusinessCTA';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import {
  generateL3Metadata,
  generateLocalBusinessSchema,
  buildBreadcrumbList,
  buildFAQPageSchema,
  buildBusinessBreadcrumbs,
} from '@/lib/seo/meta';
import { PhotoGallery } from '@/components/PhotoGallery';
import { TrackingWrapper } from '@/components/TrackingWrapper';
import { BusinessVote } from '@/components/BusinessVote';
import { TrustScoreDetail } from '@/components/TrustScoreDetail';
import { ReviewSection } from '@/components/ReviewSection';
import { generateBusinessSummary } from '@/lib/seo/business-summary';
import { formatBilingual, UI_LABELS } from '@/lib/i18n/labels';
import { getCountryByCode, getIntlRegionNameEn } from '@/lib/i18n/countries';
import { computeOpenNow } from '@/lib/enrichment/helpers';

export const revalidate = 604800; // 7 days
export const dynamicParams = true;

export async function generateStaticParams() {
  const businesses = await prisma.business.findMany({
    where: {
      slug: { not: null },
      googlePlace: {
        rating: { gte: 4.2 },
        userRatingsTotal: { gte: 10 },
        fetchStatus: 'ok',
      },
    },
    select: { slug: true },
    take: 5000,
  });

  const params = businesses
    .filter((b): b is { slug: string } => !!b.slug)
    .map(b => ({ slug: b.slug }));

  console.log(`[generateStaticParams] Business pages: ${params.length} paths`);
  return params;
}

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
}

async function getBusiness(slug: string) {
  const business = await prisma.business.findUnique({
    where: { slug },
    include: {
      primaryCategory: true,
      subcategory: true,
      googlePlace: {
        select: {
          id: true,
          placeId: true,
          rating: true,
          userRatingsTotal: true,
          formattedAddress: true,
          lat: true,
          lng: true,
          openingHoursJson: true,
          openingHoursText: true,
          website: true,
          phoneE164: true,
          photosJson: true,
          googleMapsUrl: true,
          editorialSummary: true,
          lastFetchedAt: true,
          fetchStatus: true,
        },
      },
    },
  });

  return business;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const business = await getBusiness(slug);

  if (!business) return {};

  return generateL3Metadata({
    businessName: business.nameEn || business.nameKo,
    city: business.city,
    state: business.state,
    categoryNameEn: business.primaryCategory.nameEn,
    categoryNameKo: business.primaryCategory.nameKo,
    slug: business.slug || '',
    hasGooglePlace: !!business.googlePlace,
    rating: business.googlePlace?.rating ?? undefined,
    reviewCount: business.googlePlace?.userRatingsTotal ?? undefined,
  });
}

export default async function BusinessPage({ params }: PageProps) {
  const { slug } = await params;
  const business = await getBusiness(slug);

  if (!business) notFound();

  // Korean name primary, English secondary
  const displayName = formatBilingual(business.nameKo, business.nameEn);
  const cityDisplay = toTitleCase(business.city);
  const googlePlace = business.googlePlace;

  // Extract photo references from stored URLs (strip API keys for security)
  // Only enable photos if GOOGLE_MAPS_API_KEY is configured
  const hasPhotoApiKey = !!process.env.GOOGLE_MAPS_API_KEY;
  const rawPhotos = googlePlace?.photosJson as Array<{ url: string; width: number; height: number }> | null;
  const photoRefs = hasPhotoApiKey
    ? (rawPhotos || [])
        .map((p) => {
          try {
            const u = new URL(p.url);
            return u.searchParams.get('photoreference');
          } catch { return null; }
        })
        .filter((ref): ref is string => !!ref)
    : [];
  // All photo proxy URLs for schema
  const allPhotoUrls = photoRefs.map(ref =>
    `https://www.haninmap.com/api/photo?ref=${encodeURIComponent(ref)}&maxwidth=800`
  );
  // First photo proxy URL for schema image fallback
  const firstPhotoUrl = allPhotoUrls.length > 0 ? allPhotoUrls[0] : null;

  // Country-aware data
  const countryConfig = getCountryByCode(business.countryCode ?? 'US');
  const isInternational = !!countryConfig;

  // Fetch reviews for schema
  const reviews = await prisma.review.findMany({
    where: { businessId: String(business.id), status: 'active' },
    orderBy: { createdAt: 'desc' },
    take: 5,
    select: { rating: true, content: true, createdAt: true, user: { select: { name: true } } },
  });

  // Auto-generate summary fallback for businesses without Google editorial summary
  const autoSummary = !googlePlace?.editorialSummary
    ? generateBusinessSummary({
        city: business.city,
        categoryNameKo: business.primaryCategory.nameKo,
        rating: googlePlace?.rating,
        reviewCount: googlePlace?.userRatingsTotal,
        subcategoryNameKo: business.subcategory?.nameKo,
      })
    : undefined;

  // Generate JSON-LD: LocalBusiness (enhanced)
  const localBusinessJsonLd = generateLocalBusinessSchema({
    name: displayName,
    nameKo: business.nameKo,
    address: business.addressRaw,
    city: business.city,
    state: business.state,
    zip: business.zip,
    phone: business.phoneE164 || business.phoneRaw,
    lat: googlePlace?.lat || business.lat,
    lng: googlePlace?.lng || business.lng,
    categoryNameEn: business.primaryCategory.nameEn,
    categorySlug: business.primaryCategory.slug,
    website: googlePlace?.website,
    rating: googlePlace?.rating,
    reviewCount: googlePlace?.userRatingsTotal,
    slug: business.slug || '',
    imageUrl: firstPhotoUrl,
    imageUrls: allPhotoUrls.length > 0 ? allPhotoUrls : undefined,
    googleMapsUrl: googlePlace?.googleMapsUrl,
    openingHoursText: googlePlace?.openingHoursText as string[] | null,
    addressCountry: countryConfig?.addressCountry ?? 'US',
    editorialSummary: googlePlace?.editorialSummary || autoSummary,
    reviews: reviews.length > 0 ? reviews.map(r => ({
      rating: r.rating,
      content: r.content,
      authorName: r.user.name || undefined,
      datePublished: r.createdAt.toISOString().split('T')[0],
    })) : undefined,
  });

  const breadcrumbItems = isInternational
    ? [
        { name: '홈 (Home)', url: 'https://www.haninmap.com' },
        { name: `${countryConfig.nameKo} (${countryConfig.nameEn})`, url: 'https://www.haninmap.com/regions' },
        { name: `${getIntlRegionNameEn(business.state, countryConfig.slug)} (${business.state})`,
          url: `https://www.haninmap.com/${countryConfig.slug}/${business.state.toLowerCase()}/all/${business.primaryCategory.slug}` },
        { name: `${business.primaryCategory.nameKo} (${business.primaryCategory.nameEn})`,
          url: `https://www.haninmap.com/${countryConfig.slug}/${business.state.toLowerCase()}/${business.city.toLowerCase().replace(/\s+/g, '-')}/${business.primaryCategory.slug}` },
        { name: displayName, url: `https://www.haninmap.com/biz/${business.slug || ''}` },
      ]
    : buildBusinessBreadcrumbs({
        state: business.state,
        city: business.city,
        categoryNameEn: business.primaryCategory.nameEn,
        categoryNameKo: business.primaryCategory.nameKo,
        categorySlug: business.primaryCategory.slug,
        businessName: displayName,
        businessSlug: business.slug || '',
      });
  const breadcrumbJsonLd = buildBreadcrumbList(breadcrumbItems);

  // Generate FAQs
  const faqs = generateBusinessFAQs({
    businessName: displayName,
    categoryNameEn: business.primaryCategory.nameEn,
    city: cityDisplay,
    hasHours: !!(googlePlace?.openingHoursText as string[] | null)?.length,
    hasRating: !!googlePlace?.rating,
  });

  // Generate JSON-LD: FAQPage
  const faqJsonLd = buildFAQPageSchema(faqs);

  return (
    <>
      <JsonLd data={localBusinessJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={faqJsonLd} />

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumbs UI */}
        <Breadcrumbs items={breadcrumbItems} />

        {/* Business Header */}
        <header className="border-b border-gray-200 pb-6 mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{displayName}</h1>

          <div className="flex flex-wrap items-center gap-4 mt-4">
            <span className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full">
              {business.primaryCategory.nameEn}
            </span>
            {business.subcategory && (
              <span className="inline-flex items-center px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded-full">
                {business.subcategory.nameEn}
              </span>
            )}
            {googlePlace?.rating && googlePlace.userRatingsTotal && (
              <div className="flex items-center text-sm">
                <span className="text-yellow-500 mr-1">★</span>
                <span className="font-medium">{googlePlace.rating.toFixed(1)}</span>
                <span className="text-gray-500 ml-1">
                  ({googlePlace.userRatingsTotal}개 리뷰)
                </span>
              </div>
            )}
            {(() => {
              const openNow = computeOpenNow(googlePlace?.openingHoursJson);
              if (openNow === null) return null;
              return (
                <span className={`text-sm px-3 py-1 rounded-full ${
                  openNow
                    ? 'bg-green-100 text-green-700'
                    : 'bg-red-100 text-red-700'
                }`}>
                  {openNow ? '영업중 (Open)' : '영업종료 (Closed)'}
                </span>
              );
            })()}
            <BusinessVote businessId={String(business.id)} />
          </div>
        </header>

        {/* Trust Score Breakdown */}
        <TrustScoreDetail businessId={business.id} />

        {/* Photo Gallery - proxied through /api/photo to hide API key */}
        {photoRefs.length > 0 && (
          <PhotoGallery photoRefs={photoRefs} businessName={displayName} />
        )}

        {/* Contact Information */}
        <section className="grid md:grid-cols-2 gap-8 mb-8">
          <div>
            <h2 className="text-lg font-semibold mb-4">연락처 (Contact)</h2>
            <dl className="space-y-3">
              <div>
                <dt className="text-sm text-gray-500">{UI_LABELS.address.ko} ({UI_LABELS.address.en})</dt>
                <dd className="text-gray-900">{business.addressRaw}</dd>
              </div>

              <TrackingWrapper
                businessId={String(business.id)}
                phone={(business.phoneRaw || business.phoneE164) ? (business.phoneE164 || business.phoneRaw) : undefined}
                phoneDisplay={business.phoneRaw || business.phoneE164}
                phoneLabel={`${UI_LABELS.phone.ko} (${UI_LABELS.phone.en})`}
                website={googlePlace?.website}
                websiteLabel={`${UI_LABELS.website.ko} (${UI_LABELS.website.en})`}
              >
                {null}
              </TrackingWrapper>
            </dl>
          </div>

          {/* Hours */}
          {googlePlace?.openingHoursText && (
            <div>
              <h2 className="text-lg font-semibold mb-4">{UI_LABELS.hours.ko} ({UI_LABELS.hours.en})</h2>
              <ul className="space-y-1 text-sm">
                {(googlePlace.openingHoursText as string[]).map((line, idx) => (
                  <li key={idx} className="text-gray-700">
                    {line}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        {/* Map */}
        {(() => {
          const lat = googlePlace?.lat || business.lat;
          const lng = googlePlace?.lng || business.lng;
          if (!lat || !lng) {
            return (
              <section className="mb-8">
                <h2 className="text-lg font-semibold mb-4">위치 (Location)</h2>
                <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
                  <p className="text-sm text-gray-700 mb-3">{business.addressRaw}</p>
                  <a
                    href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(business.addressRaw)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors text-sm text-gray-700"
                  >
                    🗺 Google 지도에서 보기
                  </a>
                </div>
              </section>
            );
          }

          return (
            <section className="mb-8">
              <h2 className="text-lg font-semibold mb-4">위치 (Location)</h2>
              <div className="overflow-hidden rounded-lg border border-gray-200">
                <iframe
                  src={`https://www.google.com/maps?q=${lat},${lng}&output=embed`}
                  width="100%"
                  height="300"
                  style={{ border: 0 }}
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                  title={`${business.nameKo} 위치 지도`}
                />
              </div>
              <div className="flex items-center gap-3 mt-3">
                <p className="text-sm text-gray-600 flex-1">{business.addressRaw}</p>
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 inline-flex items-center gap-1 px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
                >
                  🗺 길찾기
                </a>
              </div>
            </section>
          );
        })()}

        {/* Call to Action */}
        <BusinessCTA
          businessId={business.id}
          businessName={business.nameEn || business.nameKo}
          phone={business.phoneRaw}
          phoneE164={business.phoneE164}
          address={business.addressRaw}
          city={business.city}
          category={business.primaryCategory.nameEn}
        />

        <FAQSection faqs={faqs} />

        {/* Community Reviews */}
        <ReviewSection businessId={String(business.id)} />

        {/* Last Updated */}
        {googlePlace?.lastFetchedAt && (
          <p className="text-xs text-gray-400 mt-8">
            정보 업데이트: {new Date(googlePlace.lastFetchedAt).toLocaleDateString('ko-KR')}
          </p>
        )}

        {/* Related Businesses */}
        <RelatedBusinesses
          currentId={business.id}
          categoryId={business.primaryCategoryId}
          city={business.city}
          state={business.state}
        />
      </main>
    </>
  );
}

async function RelatedBusinesses({
  currentId,
  categoryId,
  city,
  state,
}: {
  currentId: number;
  categoryId: number;
  city: string;
  state: string;
}) {
  const related = await prisma.business.findMany({
    where: {
      id: { not: currentId },
      primaryCategoryId: categoryId,
      city,
      state,
    },
    include: {
      googlePlace: {
        select: { rating: true, userRatingsTotal: true },
      },
    },
    orderBy: { qualityScore: 'desc' },
    take: 4,
  });

  if (related.length === 0) return null;

  return (
    <section className="mt-12 border-t border-gray-200 pt-8">
      <h2 className="text-lg font-semibold mb-4">주변 유사 업체</h2>
      <div className="grid sm:grid-cols-2 gap-4">
        {related.map((biz) => (
          <Link
            key={biz.id}
            href={`/biz/${biz.slug}`}
            className="block p-4 border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
          >
            <h3 className="font-medium text-gray-900">
              {biz.nameEn || biz.nameKo}
            </h3>
            {biz.nameEn && (
              <p className="text-sm text-gray-500">{biz.nameKo}</p>
            )}
            {biz.googlePlace?.rating && (
              <div className="flex items-center text-sm mt-2">
                <span className="text-yellow-500 mr-1">★</span>
                <span>{biz.googlePlace.rating.toFixed(1)}</span>
              </div>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}

function toTitleCase(str: string): string {
  return str
    .replace(/-/g, ' ')
    .toLowerCase()
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
