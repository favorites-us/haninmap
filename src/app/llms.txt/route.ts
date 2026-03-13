import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const BASE_URL = 'https://www.haninmap.com';

export async function GET() {
  // Fetch published guides
  const guides = await prisma.guideContent.findMany({
    where: { status: 'published' },
    select: { slug: true, titleEn: true, summary: true },
    orderBy: { viewCount: 'desc' },
  });

  // Fetch category list
  const categories = await prisma.category.findMany({
    where: { level: 'primary' },
    select: { nameEn: true, nameKo: true },
    orderBy: { nameEn: 'asc' },
  });

  // Fetch coverage stats
  const usCities = await prisma.business.groupBy({
    by: ['state'],
    where: { countryCode: 'US' },
    _count: true,
  });
  const caCount = await prisma.business.count({ where: { countryCode: 'CA' } });
  const auCount = await prisma.business.count({ where: { countryCode: 'AU' } });
  const totalCount = await prisma.business.count();

  const usStates = usCities.map(s => s.state).sort().join(', ');

  const categoriesSection = categories
    .map(c => `- ${c.nameEn}: Korean ${c.nameEn.toLowerCase()} (${c.nameKo})`)
    .join('\n');

  const guidesSection = guides
    .map(g => `- [${g.titleEn}](${BASE_URL}/guides/${g.slug}): ${g.summary.slice(0, 100)}`)
    .join('\n');

  const content = `# HaninMap (한인맵)

> Korean business directory for the US, Canada, and Australia.
> Find Korean-speaking doctors, dentists, lawyers, CPAs, restaurants, and more.

## About
HaninMap is a bilingual (Korean/English) directory helping Korean Americans,
Korean Canadians, and Korean Australians find local Korean-speaking businesses
and professionals. ${totalCount.toLocaleString()}+ verified listings.

## Categories
${categoriesSection}

## Guides
${guidesSection}

## Coverage
- US: ${usStates}
- Canada: ON, BC (Toronto, Vancouver) — ${caCount.toLocaleString()} businesses
- Australia: NSW (Sydney) — ${auCount.toLocaleString()} businesses

## Optional
- [Full business listing](${BASE_URL}/llms-full.txt)
`;

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    },
  });
}
