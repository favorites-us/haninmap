import { NextResponse } from 'next/server';
import prisma from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

const MAX_BYTES = 450_000; // Stop adding before 450KB UTF-8

export async function GET() {
  // Fetch high-quality businesses matching shouldIndexL3 criteria
  const businesses = await prisma.business.findMany({
    where: {
      googlePlace: {
        rating: { gte: 4.2 },
        userRatingsTotal: { gte: 10 },
        fetchStatus: 'ok',
      },
    },
    include: {
      primaryCategory: { select: { nameEn: true } },
      googlePlace: {
        select: {
          rating: true,
          userRatingsTotal: true,
          editorialSummary: true,
          phoneE164: true,
        },
      },
    },
    orderBy: [
      { state: 'asc' },
      { city: 'asc' },
      { primaryCategory: { nameEn: 'asc' } },
      { googlePlace: { rating: 'desc' } },
    ],
  });

  let content = `# HaninMap — Full Business Listing\n\n`;
  content += `> High-quality Korean businesses (4.2+ rating, 10+ reviews)\n`;
  content += `> Generated: ${new Date().toISOString().split('T')[0]}\n\n`;

  let currentState = '';
  let currentCityCategory = '';
  let bizCountInGroup = 0;
  const statesCityCounts = new Map<string, number>();

  for (const biz of businesses) {
    // Check size limit
    if (new TextEncoder().encode(content).length > MAX_BYTES) break;

    // Enforce top 10 cities per state, top 10 businesses per city/category
    const stateKey = biz.state;
    const cityCatKey = `${biz.state}|${biz.city}|${biz.primaryCategory.nameEn}`;

    if (stateKey !== currentState) {
      currentState = stateKey;
      statesCityCounts.set(stateKey, 0);
      content += `## ${stateKey}\n\n`;
    }

    if (cityCatKey !== currentCityCategory) {
      const currentCitiesForState = statesCityCounts.get(stateKey) || 0;
      if (currentCitiesForState >= 10) continue; // Skip beyond top 10 cities
      statesCityCounts.set(stateKey, currentCitiesForState + 1);
      currentCityCategory = cityCatKey;
      bizCountInGroup = 0;
      const cityDisplay = biz.city.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      content += `### ${cityDisplay} — ${biz.primaryCategory.nameEn}\n`;
    }

    if (bizCountInGroup >= 10) continue; // Top 10 per group
    bizCountInGroup++;

    const name = biz.nameEn || biz.nameKo;
    const gp = biz.googlePlace!;
    const phone = gp.phoneE164 || biz.phoneE164 || biz.phoneRaw || '';
    const desc = gp.editorialSummary || '';
    content += `- **${name}** (${gp.rating!.toFixed(1)}★, ${gp.userRatingsTotal} reviews)`;
    if (phone) content += ` — ${phone}`;
    content += `\n`;
    if (desc) content += `  ${desc.slice(0, 150)}\n`;
  }

  // Hard floor
  if (businesses.length === 0) {
    content += `\nNo businesses currently meet the quality criteria. Visit https://www.haninmap.com for the full directory.\n`;
  }

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=3600',
    },
  });
}
