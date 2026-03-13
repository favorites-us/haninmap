/**
 * Shared page logic for international listing pages (Canada, Australia).
 * Used by src/app/canada/[region]/[city]/[category]/page.tsx
 * and src/app/australia/[region]/[city]/[category]/page.tsx.
 */

import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import prisma from '@/lib/db/prisma';
import { BusinessCard } from '@/components/BusinessCard';
import { CategoryNav } from '@/components/CategoryNav';
import { Pagination } from '@/components/Pagination';
import { FAQSection, generateCategoryFAQs } from '@/components/FAQSection';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CategoryIntro } from '@/components/CategoryIntro';
import { RelatedCategories } from '@/components/RelatedCategories';
import { JsonLd } from '@/components/JsonLd';
import {
  isPrimaryCategory,
  isSubcategory,
} from '@/lib/taxonomy/categories';
import {
  generateItemListSchema,
  buildBreadcrumbList,
  buildFAQPageSchema,
  type BreadcrumbItem,
} from '@/lib/seo/meta';
import { UI_LABELS } from '@/lib/i18n/labels';
import {
  getCountryBySlug,
  getIntlCityNameKo,
  getIntlRegionNameKo,
  getIntlRegionNameEn,
} from '@/lib/i18n/countries';
import { computeOpenNow, getTodayHours, getFirstPhotoRef } from '@/lib/enrichment/helpers';

const ITEMS_PER_PAGE = 20;
const BASE_URL = 'https://www.haninmap.com';
const MIN_LISTINGS_FOR_INDEX = 3;

async function getCategoryInfo(slug: string) {
  const category = await prisma.category.findUnique({
    where: { slug },
    include: { parent: true },
  });

  if (!category) return null;

  return {
    id: category.id,
    slug: category.slug,
    nameEn: category.nameEn,
    nameKo: category.nameKo,
    level: category.level,
    parentNameEn: category.parent?.nameEn,
    parentSlug: category.parent?.slug,
  };
}

export async function generateIntlMetadata(
  countrySlug: string,
  region: string,
  city: string,
  category: string,
  page?: number,
): Promise<Metadata> {
  const countryConfig = getCountryBySlug(countrySlug);
  if (!countryConfig) return {};

  const categoryInfo = await getCategoryInfo(category);
  if (!categoryInfo) return {};

  const cityNormalized = city.toUpperCase().replace(/-/g, ' ');
  const regionNormalized = region.toUpperCase();

  const count = await prisma.business.count({
    where: {
      countryCode: countryConfig.code,
      state: regionNormalized,
      city: cityNormalized,
      OR: [
        { primaryCategory: { slug: category } },
        { subcategory: { slug: category } },
      ],
    },
  });

  const cityKo = getIntlCityNameKo(city, countrySlug);
  const cityDisplay = toTitleCase(city.replace(/-/g, ' '));

  const title = `${cityKo} ${categoryInfo.nameKo} 한인업소 | ${cityDisplay} Korean ${categoryInfo.nameEn} - ${countryConfig.nameKo}`;

  const description = count > 0
    ? `${countryConfig.nameKo} ${cityKo} 한인 ${categoryInfo.nameKo} ${count}곳. Korean ${categoryInfo.nameEn.toLowerCase()} in ${cityDisplay}, ${countryConfig.nameEn}. 전화번호, 주소, 평점.`
    : `${countryConfig.nameKo} ${cityKo} 한인 ${categoryInfo.nameKo}. Find Korean ${categoryInfo.nameEn.toLowerCase()} in ${cityDisplay}, ${countryConfig.nameEn}.`;

  const baseUrl = `${BASE_URL}/${countrySlug}/${region}/${city}/${category}`;
  const url = page && page > 1 ? `${baseUrl}?page=${page}` : baseUrl;

  return {
    title,
    description,
    robots: count >= MIN_LISTINGS_FOR_INDEX ? 'index,follow' : 'noindex,follow',
    twitter: { card: 'summary' },
    openGraph: {
      title,
      description,
      type: 'website',
      siteName: '한인맵 HaninMap',
      url,
    },
    alternates: {
      canonical: url,
      languages: { ko: url, 'x-default': url },
    },
  };
}

export async function InternationalCategoryPage({
  countrySlug,
  region,
  city,
  category,
  page: pageNum,
}: {
  countrySlug: string;
  region: string;
  city: string;
  category: string;
  page: number;
}) {
  const countryConfig = getCountryBySlug(countrySlug);
  if (!countryConfig) notFound();

  const regionNormalized = region.toUpperCase();
  if (!countryConfig.regions[regionNormalized]) notFound();

  if (!isPrimaryCategory(category) && !isSubcategory(category)) {
    notFound();
  }

  const categoryInfo = await getCategoryInfo(category);
  if (!categoryInfo) notFound();

  const isAllCities = city.toLowerCase() === 'all';
  const cityNormalized = city.toUpperCase().replace(/-/g, ' ');

  const baseWhere = {
    countryCode: countryConfig.code,
    state: regionNormalized,
    city: isAllCities ? { not: 'Unknown' } : cityNormalized,
  };

  const whereClause = categoryInfo.level === 'primary'
    ? { ...baseWhere, primaryCategory: { slug: category } }
    : { ...baseWhere, subcategory: { slug: category } };

  const totalCount = await prisma.business.count({ where: whereClause });

  // Aggregate rating data for CategoryIntro
  const ratingAgg = await prisma.googlePlace.aggregate({
    _avg: { rating: true },
    _sum: { userRatingsTotal: true },
    where: {
      business: whereClause,
    },
  });

  // 404 for empty categories — prevents noindex pages
  if (totalCount === 0) notFound();

  const totalPages = Math.ceil(totalCount / ITEMS_PER_PAGE);

  if (pageNum > totalPages && totalPages > 0) notFound();

  const businesses = await prisma.business.findMany({
    where: whereClause,
    include: {
      googlePlace: {
        select: {
          rating: true,
          userRatingsTotal: true,
          openingHoursJson: true,
          photosJson: true,
        },
      },
      primaryCategory: true,
    },
    orderBy: [
      { googlePlace: { rating: { sort: 'desc', nulls: 'last' } } },
      { qualityScore: 'desc' },
      { nameKo: 'asc' },
    ],
    skip: (pageNum - 1) * ITEMS_PER_PAGE,
    take: ITEMS_PER_PAGE,
  });

  // Top 3 businesses by rating for CategoryIntro
  const topBusinessNames = [...businesses]
    .filter(b => b.googlePlace?.rating)
    .sort((a, b) => (b.googlePlace?.rating || 0) - (a.googlePlace?.rating || 0))
    .slice(0, 3)
    .map(b => b.nameEn || b.nameKo);

  // Distinct subcategory names for this category
  const subcategoryNames = categoryInfo.level === 'primary'
    ? await prisma.category.findMany({
        where: {
          parentId: categoryInfo.id,
          subBusinesses: {
            some: {
              countryCode: countryConfig.code,
              city: isAllCities ? { not: 'Unknown' } : cityNormalized,
              state: regionNormalized,
            },
          },
        },
        select: { nameKo: true },
        take: 5,
      }).then(cats => cats.map(c => c.nameKo))
    : [];

  const cityDisplay = toTitleCase(city.replace(/-/g, ' '));
  const cityKo = getIntlCityNameKo(city, countrySlug);
  const regionKo = getIntlRegionNameKo(regionNormalized, countrySlug);
  const regionEn = getIntlRegionNameEn(regionNormalized, countrySlug);

  const locationKo = isAllCities ? `${regionKo} 전체` : cityKo;
  const locationEn = isAllCities ? `All of ${regionEn}` : `${cityDisplay}, ${regionEn}`;

  const h1Title = `${countryConfig.nameKo} ${locationKo} 한인 ${categoryInfo.nameKo} (${categoryInfo.nameEn} in ${locationEn}, ${countryConfig.nameEn})`;
  const koreanSubtitle = `한국어 상담 가능 | Korean-speaking ${categoryInfo.nameEn.toLowerCase()}`;

  const faqs = totalCount > 0 ? generateCategoryFAQs({
    categoryNameEn: categoryInfo.nameEn,
    categoryNameKo: categoryInfo.nameKo,
    city: cityDisplay,
    cityKo,
    state: regionNormalized,
    count: totalCount,
  }) : [];

  const pageUrl = `${BASE_URL}/${countrySlug}/${region}/${city}/${category}`;
  const itemListJsonLd = generateItemListSchema(
    businesses.map((biz, idx) => ({
      name: biz.nameEn || biz.nameKo,
      slug: biz.slug || `business-${biz.id}`,
      position: (pageNum - 1) * ITEMS_PER_PAGE + idx + 1,
    })),
    pageUrl,
  );

  const breadcrumbItems: BreadcrumbItem[] = [
    { name: '홈 (Home)', url: BASE_URL },
    { name: `${countryConfig.nameKo} (${countryConfig.nameEn})`, url: `${BASE_URL}/regions` },
    { name: `${regionKo} (${regionEn})`, url: `${BASE_URL}/${countrySlug}/${region}/all/${category}` },
    { name: `${cityKo} (${cityDisplay})`, url: pageUrl },
    { name: `${categoryInfo.nameKo} (${categoryInfo.nameEn})`, url: pageUrl },
  ];
  const breadcrumbJsonLd = buildBreadcrumbList(breadcrumbItems);
  const faqJsonLd = buildFAQPageSchema(faqs);

  const basePath = `/${countrySlug}/${region}/${city}/${category}`;

  return (
    <>
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={faqJsonLd} />

      <main className="max-w-6xl mx-auto px-4 py-8">
        <Breadcrumbs items={breadcrumbItems} />

        <CategoryNav
          currentState={region}
          currentCity={city}
          currentCategory={categoryInfo.level === 'primary' ? category : undefined}
          currentSubcategory={categoryInfo.level === 'sub' ? category : undefined}
          parentCategorySlug={categoryInfo.parentSlug}
          countrySlug={countrySlug}
        />

        <header className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{h1Title}</h1>
          <h2 className="text-lg text-gray-700 mt-1">{koreanSubtitle}</h2>
          <p className="text-gray-600 mt-2">
            {totalCount} {UI_LABELS.businessesFound.ko} ({totalCount} {UI_LABELS.businessesFound.en})
          </p>
        </header>

        {totalCount > 0 && pageNum === 1 && (
          <>
            <CategoryIntro
              city={city}
              state={region}
              categoryNameEn={categoryInfo.nameEn}
              categoryNameKo={categoryInfo.nameKo}
              count={totalCount}
              avgRating={ratingAgg._avg.rating}
              reviewCount={ratingAgg._sum.userRatingsTotal}
              topBusinessNames={topBusinessNames}
              subcategories={subcategoryNames}
            />
            <RelatedCategories
              currentCategory={categoryInfo.parentSlug || categoryInfo.slug}
              state={region}
              city={city}
            />
          </>
        )}

        <IntlCityFilter
          countrySlug={countrySlug}
          countryCode={countryConfig.code}
          region={region}
          currentCity={city}
          category={category}
        />

        {businesses.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-lg">
            <p className="text-gray-600 text-lg">{UI_LABELS.noListingsYet.ko}</p>
            <p className="text-gray-500 mt-1">{UI_LABELS.noListingsYet.en}</p>
            <p className="text-gray-400 mt-4">{UI_LABELS.trySearching.ko}</p>
            <p className="text-gray-400">{UI_LABELS.trySearching.en}</p>
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              {businesses.map((business) => (
                <BusinessCard
                  key={business.id}
                  id={business.id}
                  nameKo={business.nameKo}
                  nameEn={business.nameEn}
                  addressRaw={business.addressRaw}
                  city={business.city}
                  state={business.state}
                  phoneRaw={business.phoneRaw}
                  phoneE164={business.phoneE164}
                  slug={business.slug || `business-${business.id}`}
                  rating={business.googlePlace?.rating}
                  reviewCount={business.googlePlace?.userRatingsTotal}
                  categorySlug={business.primaryCategory.slug}
                  categoryNameEn={business.primaryCategory.nameEn}
                  openNow={computeOpenNow(business.googlePlace?.openingHoursJson)}
                  photoRef={process.env.GOOGLE_MAPS_API_KEY ? getFirstPhotoRef(business.googlePlace?.photosJson) : null}
                  todayHours={getTodayHours(business.googlePlace?.openingHoursJson)}
                />
              ))}
            </div>

            <Pagination
              currentPage={pageNum}
              totalPages={totalPages}
              basePath={basePath}
            />
          </>
        )}

        {faqs.length > 0 && <FAQSection faqs={faqs} />}
      </main>
    </>
  );
}

async function IntlCityFilter({
  countrySlug,
  countryCode,
  region,
  currentCity,
  category,
}: {
  countrySlug: string;
  countryCode: string;
  region: string;
  currentCity: string;
  category: string;
}) {
  const cityNormalized = currentCity.toUpperCase().replace(/-/g, ' ');
  const isAllCities = currentCity === 'all';

  const cities = await prisma.business.groupBy({
    by: ['city'],
    where: {
      countryCode,
      state: region.toUpperCase(),
      city: { not: 'Unknown' },
      OR: [
        { primaryCategory: { slug: category } },
        { subcategory: { slug: category } },
      ],
    },
    _count: { _all: true },
    orderBy: { _count: { city: 'desc' } },
    take: 20,
  });

  const totalCount = await prisma.business.count({
    where: {
      countryCode,
      state: region.toUpperCase(),
      city: { not: 'Unknown' },
      OR: [
        { primaryCategory: { slug: category } },
        { subcategory: { slug: category } },
      ],
    },
  });

  if (cities.length <= 1) return null;

  return (
    <div className="mb-6 p-4 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-sm font-medium text-gray-700">지역 선택 (Select City)</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={`/${countrySlug}/${region}/all/${category}`}
          className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
            isAllCities
              ? 'bg-blue-600 text-white'
              : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
          }`}
        >
          전체 (All)
          <span className="ml-1 opacity-70">({totalCount.toLocaleString()})</span>
        </a>

        {cities.map((c) => {
          if (c.city.toLowerCase() === 'unknown') return null;

          const citySlug = c.city.toLowerCase().replace(/\s+/g, '-');
          const cityKo = getIntlCityNameKo(citySlug, countrySlug);
          const cityEn = toTitleCase(c.city);
          const isCurrentCity = c.city === cityNormalized;

          const displayName = cityKo !== cityEn ? `${cityKo} (${cityEn})` : cityEn;

          return (
            <a
              key={c.city}
              href={`/${countrySlug}/${region}/${citySlug}/${category}`}
              className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
                isCurrentCity
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-100'
              }`}
            >
              {displayName}
              <span className="ml-1 opacity-70">({c._count._all})</span>
            </a>
          );
        })}
      </div>
    </div>
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
