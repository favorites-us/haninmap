import { Metadata } from 'next';
import Link from 'next/link';
import prisma from '@/lib/db/prisma';
import { PRIMARY_CATEGORIES } from '@/lib/taxonomy/categories';
import { JsonLd } from '@/components/JsonLd';

// ISR: revalidate every hour
export const revalidate = 3600;

const BASE_URL = 'https://www.haninmap.com';

export const metadata: Metadata = {
  title: '한인맵 HaninMap | Korean Business Directory 한인 업소록',
  description:
    '한인 병원, 치과, 변호사, 식당 찾기. Find Korean-speaking doctors, dentists, lawyers, restaurants and more. 미국 한인 업소 디렉토리.',
  alternates: {
    canonical: BASE_URL,
    languages: {
      'ko': BASE_URL,
      'en': BASE_URL,
      'x-default': BASE_URL,
    },
  },
  openGraph: {
    title: '한인맵 HaninMap | Korean Business Directory',
    description: '한인 병원, 치과, 변호사, 식당 찾기. Find Korean-speaking businesses in the United States.',
    url: BASE_URL,
    siteName: '한인맵 HaninMap',
    type: 'website',
  },
};

export default async function HomePage() {
  // Get top cities by business count
  const topCities = await prisma.business.groupBy({
    by: ['city', 'state'],
    _count: true,
    orderBy: { _count: { city: 'desc' } },
    take: 12,
  });

  // Get total business count
  const totalBusinesses = await prisma.business.count();

  const websiteSchema = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: '한인맵 HaninMap',
    alternateName: 'Korean Business Directory',
    url: BASE_URL,
    description: '미국, 캐나다, 호주 한인 업소 종합 디렉토리. Find Korean-speaking businesses worldwide.',
    inLanguage: ['ko', 'en'],
  };

  const organizationSchema = {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: '한인맵 HaninMap',
    alternateName: 'Korean Business Directory 한인 업소록',
    url: BASE_URL,
    description: '미국, 캐나다, 호주 한인 업소를 쉽게 찾을 수 있는 종합 디렉토리',
    areaServed: ['US', 'CA', 'AU'],
    knowsLanguage: ['ko', 'en'],
  };

  return (
    <>
    <JsonLd data={websiteSchema} />
    <JsonLd data={organizationSchema} />
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Hero Section */}
      <header className="text-center py-12">
        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-2">
          한인맵 HaninMap
        </h1>
        <h2 className="text-xl text-gray-700 mb-4">
          Korean Business Directory | 한인 업소록
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          한인 병원, 치과, 변호사, 식당 등 {totalBusinesses.toLocaleString()}개 업체 정보.
          <br />
          Find Korean-speaking doctors, dentists, lawyers, restaurants and more.
        </p>
      </header>

      {/* Quick Search by Category */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">카테고리별 찾기 (Browse by Category)</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {PRIMARY_CATEGORIES.map((category) => (
            <CategoryCard
              key={category.slug}
              slug={category.slug}
              nameEn={category.nameEn}
              nameKo={category.nameKo}
            />
          ))}
        </div>
      </section>

      {/* Top Cities */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">주요 도시 (Popular Cities)</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {topCities.map((loc) => (
            <CityCard
              key={`${loc.state}-${loc.city}`}
              city={loc.city}
              state={loc.state}
              count={loc._count}
            />
          ))}
        </div>
      </section>

      {/* Featured Categories by City */}
      <section className="mb-12">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">인기 검색 (Popular Searches)</h2>
        <div className="flex flex-wrap gap-2">
          <QuickLink href="/ca/los-angeles/medical">Korean Doctors in Los Angeles</QuickLink>
          <QuickLink href="/ca/los-angeles/dental">Korean Dentists in Los Angeles</QuickLink>
          <QuickLink href="/ca/los-angeles/legal">Korean Lawyers in Los Angeles</QuickLink>
          <QuickLink href="/ca/irvine/medical">Korean Doctors in Irvine</QuickLink>
          <QuickLink href="/ca/garden-grove/food">Korean Restaurants in Garden Grove</QuickLink>
          <QuickLink href="/ca/fullerton/dental">Korean Dentists in Fullerton</QuickLink>
          <QuickLink href="/ca/torrance/medical">Korean Doctors in Torrance</QuickLink>
          <QuickLink href="/ca/los-angeles/real-estate">Korean Real Estate in Los Angeles</QuickLink>
        </div>
      </section>

      {/* Guide Section */}
      <GuideSection />

      {/* Top Trusted Businesses */}
      <TopTrustedBusinesses />

      {/* Latest Alerts */}
      <LatestAlerts />

      {/* Popular Guides */}
      <PopularGuides />

      {/* About Section */}
      <section className="bg-gray-50 rounded-lg p-6 mt-12">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">한인맵 소개 (About HaninMap)</h2>
        <p className="text-gray-600 text-sm leading-relaxed mb-3">
          한인맵은 미국 내 한인 업소를 쉽게 찾을 수 있는 종합 디렉토리입니다.
          한인 병원, 치과, 변호사, 식당 등 다양한 업종의 정보를 제공합니다.
        </p>
        <p className="text-gray-600 text-sm leading-relaxed">
          HaninMap is the most comprehensive directory of Korean-speaking businesses in the United States.
          Our listings include verified contact information, Google ratings, and business hours.
        </p>
      </section>
    </main>
    </>
  );
}

function CategoryCard({
  slug,
  nameEn,
  nameKo,
}: {
  slug: string;
  nameEn: string;
  nameKo: string;
}) {
  return (
    <Link
      href={`/ca/los-angeles/${slug}`}
      className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
    >
      <p className="font-medium text-gray-900">{nameEn}</p>
      <p className="text-sm text-gray-500">{nameKo}</p>
    </Link>
  );
}

function CityCard({
  city,
  state,
  count,
}: {
  city: string;
  state: string;
  count: number;
}) {
  const citySlug = city.toLowerCase().replace(/\s+/g, '-');
  const stateSlug = state.toLowerCase();
  const cityDisplay = city
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');

  return (
    <Link
      href={`/${stateSlug}/${citySlug}/medical`}
      className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
    >
      <p className="font-medium text-gray-900">{cityDisplay}</p>
      <p className="text-sm text-gray-500">
        {state.toUpperCase()} - {count.toLocaleString()} businesses
      </p>
    </Link>
  );
}

async function GuideSection() {
  const guides = await prisma.guideContent.findMany({
    where: { status: 'published' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    select: { slug: true, titleKo: true, summary: true, categorySlug: true },
  });

  if (guides.length === 0) return null;

  return (
    <section className="mb-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">미국 생활 가이드 (Life in the US)</h2>
        <Link href="/guides" className="text-sm text-blue-600 hover:underline">
          전체 보기 &rarr;
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {guides.map((guide) => (
          <Link
            key={guide.slug}
            href={`/guides/${guide.slug}`}
            className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <span className="inline-block px-2 py-0.5 text-xs bg-blue-50 text-blue-700 rounded mb-2">
              {guide.categorySlug}
            </span>
            <p className="font-medium text-gray-900 mb-1">{guide.titleKo}</p>
            <p className="text-sm text-gray-500 line-clamp-2">{guide.summary}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

async function TopTrustedBusinesses() {
  const trustScores = await prisma.trustScore.findMany({
    orderBy: { engagementScore: 'desc' },
    take: 5,
    select: { businessId: true, totalScore: true },
  });

  if (trustScores.length === 0) return null;

  const businessIds = trustScores.map((t) => t.businessId);

  const businesses = await prisma.business.findMany({
    where: { id: { in: businessIds } },
    select: {
      id: true,
      nameKo: true,
      city: true,
      slug: true,
      primaryCategory: { select: { nameKo: true } },
    },
  });

  // Maintain trust score ordering
  const bizMap = new Map(businesses.map((b) => [b.id, b]));
  const scoreMap = new Map(trustScores.map((t) => [t.businessId, t.totalScore]));
  const ordered = trustScores
    .map((t) => bizMap.get(t.businessId))
    .filter(Boolean) as typeof businesses;

  if (ordered.length === 0) return null;

  return (
    <section className="border-t pt-12 mt-12">
      <h2 className="text-xl font-semibold text-gray-900 mb-6">
        한인이 가장 많이 찾는 업체
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {ordered.map((biz) => {
          const score = scoreMap.get(biz.id) || 0;
          return (
            <Link
              key={biz.id}
              href={`/biz/${biz.slug || `business-${biz.id}`}`}
              className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
            >
              <p className="font-medium text-gray-900">{biz.nameKo}</p>
              <p className="text-sm text-gray-500 mt-1">
                {biz.city} &middot; {biz.primaryCategory.nameKo}
              </p>
              <span className={`inline-block mt-2 text-xs font-medium px-2 py-0.5 rounded-full ${
                score >= 80
                  ? 'bg-green-50 text-green-700'
                  : score >= 60
                    ? 'bg-yellow-50 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
              }`}>
                신뢰점수 {Math.round(score)}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

async function LatestAlerts() {
  const alerts = await prisma.alertFeed.findMany({
    where: { status: 'published' },
    orderBy: { publishedAt: 'desc' },
    take: 3,
    select: {
      id: true,
      slug: true,
      titleKo: true,
      severity: true,
      publishedAt: true,
    },
  });

  if (alerts.length === 0) return null;

  const severityStyles: Record<string, string> = {
    critical: 'bg-red-100 text-red-700',
    warning: 'bg-yellow-100 text-yellow-700',
    info: 'bg-blue-100 text-blue-700',
  };

  const severityLabels: Record<string, string> = {
    critical: '긴급',
    warning: '주의',
    info: '안내',
  };

  return (
    <section className="border-t pt-12 mt-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">최신 알림</h2>
        <Link href="/alerts" className="text-sm text-blue-600 hover:underline">
          전체 알림 보기 &rarr;
        </Link>
      </div>
      <div className="space-y-3">
        {alerts.map((alert) => (
          <Link
            key={alert.id}
            href={`/alerts#${alert.slug}`}
            className="flex items-center gap-3 p-4 bg-white border border-gray-200 rounded-lg hover:border-gray-300 transition-colors"
          >
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${
              severityStyles[alert.severity] || severityStyles.info
            }`}>
              {severityLabels[alert.severity] || '안내'}
            </span>
            <p className="font-medium text-gray-900 flex-1 line-clamp-1">{alert.titleKo}</p>
            <span className="text-xs text-gray-400 whitespace-nowrap">
              {alert.publishedAt.toLocaleDateString('ko-KR')}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}

async function PopularGuides() {
  const guides = await prisma.guideContent.findMany({
    where: { status: 'published' },
    orderBy: { viewCount: 'desc' },
    take: 3,
    select: { slug: true, titleKo: true, summary: true },
  });

  if (guides.length === 0) return null;

  return (
    <section className="border-t pt-12 mt-12">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-gray-900">인기 가이드</h2>
        <Link href="/guides" className="text-sm text-blue-600 hover:underline">
          전체 보기 &rarr;
        </Link>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {guides.map((guide) => (
          <Link
            key={guide.slug}
            href={`/guides/${guide.slug}`}
            className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 hover:shadow-sm transition-all"
          >
            <p className="font-medium text-gray-900 mb-1">{guide.titleKo}</p>
            <p className="text-sm text-gray-500 line-clamp-2">{guide.summary}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}

function QuickLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-full hover:bg-gray-200 transition-colors"
    >
      {children}
    </Link>
  );
}
