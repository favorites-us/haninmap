import { NextResponse } from 'next/server';

// Force dynamic rendering
export const dynamic = 'force-dynamic';

// Canonical base URL
const BASE_URL = 'https://www.haninmap.com';

/**
 * Sitemap Index - points to individual sitemaps
 * This prevents response truncation issues with large sitemaps
 */
export async function GET() {
  const sitemaps = [
    'sitemap-static.xml',
    'sitemap-cities.xml',
    'sitemap-us-categories.xml',
    'sitemap-intl-categories.xml',
    'sitemap-businesses.xml',
    'sitemap-guides.xml',
  ];

  const today = new Date().toISOString().split('T')[0];

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
`;

  for (const sitemap of sitemaps) {
    xml += `  <sitemap>
    <loc>${BASE_URL}/${sitemap}</loc>
    <lastmod>${today}</lastmod>
  </sitemap>
`;
  }

  xml += '</sitemapindex>';

  return new NextResponse(xml, {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'public, max-age=3600, s-maxage=3600',
    },
  });
}
