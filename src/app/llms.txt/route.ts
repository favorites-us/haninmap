import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const BASE_URL = 'https://www.haninmap.com';

export async function GET() {
  // Parallel queries for dynamic content
  const [topCities, guides, topBusinesses, categories] = await Promise.all([
    // Top 20 city+category combos by business count
    prisma.business.groupBy({
      by: ['city', 'state', 'primaryCategoryId'],
      _count: { _all: true },
      where: { countryCode: 'US' },
      orderBy: { _count: { city: 'desc' } },
      take: 20,
    }),
    // Published guides
    prisma.guideContent.findMany({
      where: { status: 'published' },
      orderBy: { viewCount: 'desc' },
      select: { slug: true, titleKo: true, titleEn: true },
    }),
    // Top rated businesses
    prisma.business.findMany({
      where: {
        slug: { not: null },
        googlePlace: {
          rating: { gte: 4.5 },
          userRatingsTotal: { gte: 20 },
        },
      },
      include: {
        googlePlace: { select: { rating: true, userRatingsTotal: true } },
        primaryCategory: { select: { nameEn: true } },
      },
      orderBy: { googlePlace: { userRatingsTotal: 'desc' } },
      take: 10,
    }),
    // All primary categories
    prisma.category.findMany({
      where: { level: 'primary' },
      select: { slug: true, nameEn: true, nameKo: true },
    }),
  ]);

  // Build category ID → slug map
  const catMap = new Map<number, string>();
  const allCats = await prisma.category.findMany({
    where: { id: { in: topCities.map(c => c.primaryCategoryId) } },
    select: { id: true, slug: true },
  });
  allCats.forEach(c => catMap.set(c.id, c.slug));

  // Build popular pages section
  const popularPages = topCities
    .filter(c => c.city && c.state && catMap.has(c.primaryCategoryId))
    .map(c => {
      const citySlug = c.city.toLowerCase().replace(/\s+/g, '-');
      const stateSlug = c.state.toLowerCase();
      const catSlug = catMap.get(c.primaryCategoryId)!;
      return `- ${BASE_URL}/${stateSlug}/${citySlug}/${catSlug} (${c._count._all} businesses)`;
    })
    .join('\n');

  // Build guides section
  const guidesSection = guides.length > 0
    ? guides.map(g => `- ${BASE_URL}/guides/${g.slug} — ${g.titleEn}`).join('\n')
    : '- No guides published yet';

  // Build top businesses section
  const topBizSection = topBusinesses
    .map(b => {
      const rating = b.googlePlace?.rating?.toFixed(1) || 'N/A';
      const reviews = b.googlePlace?.userRatingsTotal || 0;
      const name = b.nameEn || b.nameKo;
      return `- ${BASE_URL}/biz/${b.slug} — ${name} (${b.primaryCategory.nameEn}, ${rating}★, ${reviews} reviews)`;
    })
    .join('\n');

  // Build categories section
  const categoriesSection = categories
    .map(c => `- ${c.nameEn} (${c.nameKo}): ${BASE_URL}/ca/los-angeles/${c.slug}`)
    .join('\n');

  const content = `# 한인맵 HaninMap
> Korean Business Directory for the United States, Canada, and Australia

## About
HaninMap (한인맵) is the most comprehensive directory of Korean-speaking businesses.
We help Korean Americans find doctors, dentists, lawyers, restaurants, and other professionals
who speak Korean. Our database includes 78,000+ verified business listings with contact
information, Google ratings, business hours, and user reviews.

## Coverage
- United States: ~69,887 businesses across all 50 states
- Canada: ~4,956 businesses (Ontario, British Columbia, Alberta)
- Australia: ~1,735 businesses (NSW, VIC, QLD)

## Categories (15 primary)
${categoriesSection}

## URL Structure
- Homepage: ${BASE_URL}
- US Categories: ${BASE_URL}/{state}/{city}/{category}
- Business Detail: ${BASE_URL}/biz/{slug}
- Canada: ${BASE_URL}/canada/{region}/{city}/{category}
- Australia: ${BASE_URL}/australia/{region}/{city}/{category}
- Guides: ${BASE_URL}/guides/{slug}
- City Hubs: ${BASE_URL}/{state}/{city}

## Popular Pages
${popularPages}

## Life Guides
${guidesSection}

## Top Rated Businesses
${topBizSection}

## Content
- Business listings with NAP (Name, Address, Phone), Google ratings, hours
- Life guides for Korean Americans (taxes, immigration, insurance, housing)
- IRS/government alerts in Korean
- Bilingual content (Korean + English) on all pages

## Data Sources
- Google Places API (ratings, hours, photos)
- Community-submitted reviews and trust scores
- Government data feeds (IRS alerts)

## Sitemap
${BASE_URL}/sitemap.xml
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=43200',
    },
  });
}
