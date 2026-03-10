import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';
import { isMalformedCity } from '@/lib/seo/slug-utils';

export const dynamic = 'force-dynamic';

const BASE_URL = 'https://www.haninmap.com';

export async function GET() {
  // Group cities with 3+ businesses
  const cityCounts = await prisma.business.groupBy({
    by: ['city', 'state'],
    _count: { _all: true },
    where: { countryCode: 'US' },
  });

  const today = new Date().toISOString().split('T')[0];

  const entries = cityCounts
    .filter(c => c._count._all >= 3 && c.city && c.state && !isMalformedCity(c.city))
    .map(c => {
      const citySlug = c.city.toLowerCase().replace(/\s+/g, '-');
      const stateSlug = c.state.toLowerCase();
      return `  <url>
    <loc>${BASE_URL}/${stateSlug}/${citySlug}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
  </url>`;
    });

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>`;

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
