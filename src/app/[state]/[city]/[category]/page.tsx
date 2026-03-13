import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import prisma from '@/lib/db/prisma';
import { BusinessCard } from '@/components/BusinessCard';
import { CategoryNav } from '@/components/CategoryNav';
import { Pagination } from '@/components/Pagination';
import { FAQSection, generateCategoryFAQs } from '@/components/FAQSection';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { CategoryIntro } from '@/components/CategoryIntro';
import { RelatedCategories } from '@/components/RelatedCategories';
import { CityFilter } from '@/components/CityFilter';
import { JsonLd } from '@/components/JsonLd';
import {
  isPrimaryCategory,
  isSubcategory,
  getPrimaryCategory,
  getSubcategory,
} from '@/lib/taxonomy/categories';
import {
  generateL1Metadata,
  generateL2Metadata,
  generateItemListSchema,
  buildBreadcrumbList,
  buildFAQPageSchema,
  buildCategoryBreadcrumbs,
} from '@/lib/seo/meta';
import { getCityNameKo, getStateNameKo, UI_LABELS } from '@/lib/i18n/labels';
import { computeOpenNow, getTodayHours, getFirstPhotoRef } from '@/lib/enrichment/helpers';
import { isMalformedCity } from '@/lib/seo/slug-utils';

export const revalidate = 86400; // 24 hours
export const dynamicParams = true;

const ITEMS_PER_PAGE = 20;
const BASE_URL = 'https://www.haninmap.com';

interface PageProps {
  params: Promise<{
    state: string;
    city: string;
    category: string;
  }>;
  searchParams: Promise<{
    page?: string;
    sort?: string;
  }>;
}

export async function generateStaticParams() {
  const MIN_COUNT = 50;

  const categories = await prisma.category.findMany({
    select: { id: true, slug: true, level: true },
  });
  const categoryMap = new Map(categories.map(c => [c.id, c]));

  const params: Array<{ state: string; city: string; category: string }> = [];
  const added = new Set<string>();

  // Primary categories with 50+ businesses
  const primaryCounts = await prisma.business.groupBy({
    by: ['city', 'state', 'primaryCategoryId'],
    _count: { _all: true },
    where: { countryCode: 'US' },
    having: { city: { _count: { gte: MIN_COUNT } } },
  });

  for (const item of primaryCounts) {
    if (!item.city || !item.state || !item.primaryCategoryId) continue;
    if (item._count._all < MIN_COUNT) continue;
    if (isMalformedCity(item.city)) continue;

    const cat = categoryMap.get(item.primaryCategoryId);
    if (!cat || cat.level !== 'primary') continue;

    const key = `${item.state}|${item.city}|${cat.slug}`;
    if (added.has(key)) continue;
    added.add(key);

    params.push({
      state: item.state.toLowerCase(),
      city: item.city.toLowerCase().replace(/\s+/g, '-'),
      category: cat.slug,
    });
  }

  // Subcategories with 50+ businesses
  const subCounts = await prisma.business.groupBy({
    by: ['city', 'state', 'subcategoryId'],
    _count: { _all: true },
    where: { countryCode: 'US', subcategoryId: { not: null } },
    having: { city: { _count: { gte: MIN_COUNT } } },
  });

  for (const item of subCounts) {
    if (!item.city || !item.state || !item.subcategoryId) continue;
    if (item._count._all < MIN_COUNT) continue;
    if (isMalformedCity(item.city)) continue;

    const cat = categoryMap.get(item.subcategoryId);
    if (!cat || cat.level !== 'sub') continue;

    const key = `${item.state}|${item.city}|${cat.slug}`;
    if (added.has(key)) continue;
    added.add(key);

    params.push({
      state: item.state.toLowerCase(),
      city: item.city.toLowerCase().replace(/\s+/g, '-'),
      category: cat.slug,
    });
  }

  console.log(`[generateStaticParams] Category pages: ${params.length} paths`);
  return params;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { state, city, category } = await params;
  const { page: pageParam } = await searchParams;

  // Get category info
  const categoryInfo = await getCategoryInfo(category);
  if (!categoryInfo) return {};

  const cityNormalized = city.toUpperCase().replace(/-/g, ' ');

  // Get count
  const count = await prisma.business.count({
    where: {
      city: cityNormalized,
      state: state.toUpperCase(),
      OR: [
        { primaryCategory: { slug: category } },
        { subcategory: { slug: category } },
      ],
    },
  });

  const page = parseInt(pageParam || '1', 10) || 1;

  if (categoryInfo.level === 'primary') {
    const taxonomyData = getPrimaryCategory(category);
    return generateL1Metadata({
      city,
      state,
      categoryNameEn: categoryInfo.nameEn,
      categoryNameKo: categoryInfo.nameKo,
      count,
      categorySlug: categoryInfo.slug,
      categoryDescriptionKo: taxonomyData?.descriptionKo,
      categoryDescriptionEn: taxonomyData?.descriptionEn,
      page,
    });
  } else {
    const taxonomyData = getSubcategory(category);
    return generateL2Metadata({
      city,
      state,
      subcategoryNameEn: categoryInfo.nameEn,
      subcategoryNameKo: categoryInfo.nameKo,
      primaryCategoryNameEn: categoryInfo.parentNameEn || categoryInfo.nameEn,
      count,
      subcategorySlug: categoryInfo.slug,
      subcategoryDescriptionKo: taxonomyData?.subcategory.descriptionKo,
      subcategoryDescriptionEn: taxonomyData?.subcategory.descriptionEn,
      page,
    });
  }
}

async function getCategoryInfo(slug: string): Promise<{
  id: number;
  slug: string;
  nameEn: string;
  nameKo: string;
  level: string;
  parentNameEn?: string;
  parentSlug?: string;
} | null> {
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

export default async function CategoryPage({ params, searchParams }: PageProps) {
  const { state, city, category } = await params;
  const { page: pageParam, sort: sortParam } = await searchParams;
  const sort = ['trust', 'rating', 'reviews', 'recent'].includes(sortParam || '')
    ? sortParam!
    : 'trust';

  const page = parseInt(pageParam || '1', 10);
  if (isNaN(page) || page < 1) notFound();

  // Validate category
  if (!isPrimaryCategory(category) && !isSubcategory(category)) {
    notFound();
  }

  const categoryInfo = await getCategoryInfo(category);
  if (!categoryInfo) notFound();

  const isAllCities = city.toLowerCase() === 'all';
  const cityNormalized = city.toUpperCase().replace(/-/g, ' ');
  const stateNormalized = state.toUpperCase();

  // Build where clause based on category type and city filter
  const baseWhere = {
    state: stateNormalized,
    city: isAllCities ? { not: 'Unknown' } : cityNormalized,
  };

  const whereClause = categoryInfo.level === 'primary'
    ? {
        ...baseWhere,
        primaryCategory: { slug: category },
      }
    : {
        ...baseWhere,
        subcategory: { slug: category },
      };

  // Get total count
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

  if (page > totalPages && totalPages > 0) notFound();

  // Build sort order based on sort param
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const orderByMap: Record<string, any[]> = {
    trust: [
      { qualityScore: 'desc' },
      { nameKo: 'asc' },
    ],
    rating: [
      { googlePlace: { rating: { sort: 'desc', nulls: 'last' } } },
      { qualityScore: 'desc' },
      { nameKo: 'asc' },
    ],
    reviews: [
      { googlePlace: { userRatingsTotal: { sort: 'desc', nulls: 'last' } } },
      { qualityScore: 'desc' },
      { nameKo: 'asc' },
    ],
    recent: [
      { createdAt: 'desc' },
      { nameKo: 'asc' },
    ],
  };

  // Fetch businesses with pagination
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
    orderBy: orderByMap[sort] || orderByMap.trust,
    skip: (page - 1) * ITEMS_PER_PAGE,
    take: ITEMS_PER_PAGE,
  });

  // Fetch trust score data for displayed businesses
  const businessIds = businesses.map((b) => String(b.id));

  const [trustScores, mentionAggs, upVoteAggs] = await Promise.all([
    prisma.trustScore.findMany({
      where: { businessId: { in: businessIds } },
      select: { businessId: true, totalScore: true },
    }),
    prisma.communityMention.groupBy({
      by: ['businessId'],
      where: { businessId: { in: businessIds } },
      _sum: { mentionCount: true },
    }),
    prisma.businessVote.groupBy({
      by: ['businessId'],
      where: { businessId: { in: businessIds }, voteType: 'up' },
      _count: true,
    }),
  ]);

  const trustMap = new Map(trustScores.map((t) => [t.businessId, t.totalScore]));
  const mentionMap = new Map(mentionAggs.map((m) => [m.businessId, m._sum.mentionCount || 0]));
  const upVoteMap = new Map(upVoteAggs.map((v) => [v.businessId, v._count]));

  // If sorting by trust, re-sort businesses by trust score (since Prisma can't join TrustScore)
  let sortedBusinesses = businesses;
  if (sort === 'trust') {
    sortedBusinesses = [...businesses].sort((a, b) => {
      const scoreA = trustMap.get(String(a.id)) || 0;
      const scoreB = trustMap.get(String(b.id)) || 0;
      return scoreB - scoreA;
    });
  }

  // Top 3 businesses by rating for CategoryIntro
  const topBusinessNames = sortedBusinesses
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
              city: isAllCities ? { not: 'Unknown' } : cityNormalized,
              state: stateNormalized,
            },
          },
        },
        select: { nameKo: true },
        take: 5,
      }).then(cats => cats.map(c => c.nameKo))
    : [];

  // Fetch city data for CityFilter
  const cityData = await prisma.business.groupBy({
    by: ['city'],
    where: {
      state: stateNormalized,
      city: { not: 'Unknown' },
      OR: [
        { primaryCategory: { slug: category } },
        { subcategory: { slug: category } },
      ],
    },
    _count: true,
    orderBy: { _count: { city: 'desc' } },
    take: 20,
  });

  const cityTotalCount = await prisma.business.count({
    where: {
      state: stateNormalized,
      city: { not: 'Unknown' },
      OR: [
        { primaryCategory: { slug: category } },
        { subcategory: { slug: category } },
      ],
    },
  });

  const cityFilterData = cityData
    .filter(c => c.city.toLowerCase() !== 'unknown')
    .map(c => ({ city: c.city, count: c._count }));

  // Generate page title (Korean primary for H1)
  const cityDisplay = toTitleCase(city);
  const cityKo = getCityNameKo(city);
  const stateDisplay = stateNormalized;

  const locationKo = isAllCities ? `${getStateNameKo(stateDisplay)} 전체` : cityKo;

  // Get unique description from taxonomy
  const taxonomyDesc = categoryInfo.level === 'primary'
    ? getPrimaryCategory(category)?.descriptionKo
    : getSubcategory(category)?.subcategory.descriptionKo;

  // FAQs
  const faqs = totalCount > 0 ? generateCategoryFAQs({
    categoryNameEn: categoryInfo.nameEn,
    categoryNameKo: categoryInfo.nameKo,
    city: cityDisplay,
    cityKo: cityKo,
    state: stateDisplay,
    count: totalCount,
  }) : [];

  // JSON-LD: ItemList
  const itemListJsonLd = generateItemListSchema(
    businesses.map((biz, idx) => ({
      name: biz.nameEn || biz.nameKo,
      slug: biz.slug || `business-${biz.id}`,
      position: (page - 1) * ITEMS_PER_PAGE + idx + 1,
    })),
    `${BASE_URL}/${state}/${city}/${category}`
  );

  // JSON-LD: BreadcrumbList
  const breadcrumbItems = buildCategoryBreadcrumbs({
    state,
    city,
    categoryNameEn: categoryInfo.nameEn,
    categoryNameKo: categoryInfo.nameKo,
    categorySlug: categoryInfo.slug,
  });
  const breadcrumbJsonLd = buildBreadcrumbList(breadcrumbItems);

  // JSON-LD: FAQPage
  const faqJsonLd = buildFAQPageSchema(faqs);

  const basePath = `/${state}/${city}/${category}`;

  return (
    <>
      <JsonLd data={itemListJsonLd} />
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={faqJsonLd} />

      <main className="max-w-6xl mx-auto px-4 py-8">
        {/* Breadcrumbs UI */}
        <Breadcrumbs items={breadcrumbItems} />

        <header className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">
            {locationKo} 한인 {categoryInfo.nameKo} {totalCount}곳
          </h1>
          {taxonomyDesc && (
            <p className="text-gray-600 mt-1 text-sm">{taxonomyDesc}</p>
          )}
        </header>

        {/* Filters: City → Category → Subcategory */}
        <CityFilter
          cities={cityFilterData}
          totalCount={cityTotalCount}
          state={state}
          currentCity={city}
          category={category}
        />

        <CategoryNav
          currentState={state}
          currentCity={city}
          currentCategory={categoryInfo.level === 'primary' ? category : undefined}
          currentSubcategory={categoryInfo.level === 'sub' ? category : undefined}
          parentCategorySlug={categoryInfo.parentSlug}
        />

        {/* Sort Options */}
        <SortPills basePath={basePath} currentSort={sort} />

        {/* Business Cards + Pagination */}
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
              {sortedBusinesses.map((business) => (
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
                  trustScore={trustMap.get(String(business.id))}
                  communityMentions={mentionMap.get(String(business.id))}
                  upVotes={upVoteMap.get(String(business.id))}
                  photoRef={process.env.GOOGLE_MAPS_API_KEY ? getFirstPhotoRef(business.googlePlace?.photosJson) : null}
                  todayHours={getTodayHours(business.googlePlace?.openingHoursJson)}
                />
              ))}
            </div>

            <Pagination
              currentPage={page}
              totalPages={totalPages}
              basePath={basePath}
            />
          </>
        )}

        {/* Category Intro (unique content block) - only on page 1 */}
        {totalCount > 0 && page === 1 && (
          <>
            <CategoryIntro
              city={city}
              state={state}
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
              state={state}
              city={city}
            />
          </>
        )}

        {/* Related Guides */}
        {page === 1 && (
          <RelatedGuides
            categorySlug={categoryInfo.parentSlug || categoryInfo.slug}
            categoryNameKo={categoryInfo.nameKo}
          />
        )}

        {faqs.length > 0 && <FAQSection faqs={faqs} />}
      </main>
    </>
  );
}

async function RelatedGuides({
  categorySlug,
  categoryNameKo,
}: {
  categorySlug: string;
  categoryNameKo: string;
}) {
  const guides = await prisma.guideContent.findMany({
    where: {
      categorySlug,
      status: 'published',
    },
    orderBy: { viewCount: 'desc' },
    take: 2,
    select: { slug: true, titleKo: true, summary: true },
  });

  if (guides.length === 0) return null;

  return (
    <section className="mt-8 mb-8">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">
        관련 가이드 ({categoryNameKo})
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        {guides.map((guide) => (
          <Link
            key={guide.slug}
            href={`/guides/${guide.slug}`}
            className="block p-4 bg-blue-50 border border-blue-100 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <p className="font-medium text-gray-900 mb-1">{guide.titleKo}</p>
            <p className="text-sm text-gray-600 line-clamp-2">{guide.summary}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

const SORT_OPTIONS = [
  { key: 'trust', label: '신뢰점수순' },
  { key: 'rating', label: '별점순' },
  { key: 'reviews', label: '리뷰순' },
  { key: 'recent', label: '최신순' },
] as const;

function SortPills({ basePath, currentSort }: { basePath: string; currentSort: string }) {
  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {SORT_OPTIONS.map((opt) => {
        const isActive = opt.key === currentSort;
        const href = opt.key === 'trust' ? basePath : `${basePath}?sort=${opt.key}`;
        return (
          <Link
            key={opt.key}
            href={href}
            className={`px-3 py-1.5 text-sm rounded-full transition-colors ${
              isActive
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            {opt.label}
          </Link>
        );
      })}
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
