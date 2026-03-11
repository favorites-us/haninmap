/**
 * Category Distribution Audit
 * Analyzes category counts by primary/sub per source
 * Run: npx tsx scripts/audit-category-distribution.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

interface SourceKey {
  source: string;
  uid: string;
}

interface DistributionResult {
  timestamp: string;
  summary: {
    totalBusinesses: number;
    bySource: Record<string, number>;
    byPrimaryCategory: Record<string, number>;
  };
  primaryBySource: Record<string, Record<string, number>>;
  subBySource: Record<string, Record<string, number>>;
  top50SubcategoriesBySource: Record<string, Array<{ slug: string; nameKo: string; count: number }>>;
  spikes: Array<{ category: string; source: string; count: number; percentOfSource: number }>;
}

async function main() {
  console.log('=== Category Distribution Audit ===\n');

  const result: DistributionResult = {
    timestamp: new Date().toISOString(),
    summary: {
      totalBusinesses: 0,
      bySource: {},
      byPrimaryCategory: {},
    },
    primaryBySource: {},
    subBySource: {},
    top50SubcategoriesBySource: {},
    spikes: [],
  };

  // Get all businesses with categories
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      sourceKeys: true,
      primaryCategory: { select: { slug: true, nameKo: true, nameEn: true } },
      subcategory: { select: { slug: true, nameKo: true, nameEn: true } },
    },
  });

  result.summary.totalBusinesses = businesses.length;
  console.log(`Total businesses: ${businesses.length}`);

  // Initialize counters
  const sourceCounters: Record<string, number> = { radiokorea: 0, koreadaily: 0, unknown: 0 };
  const primaryBySource: Record<string, Record<string, number>> = {
    radiokorea: {},
    koreadaily: {},
    all: {},
  };
  const subBySource: Record<string, Record<string, number>> = {
    radiokorea: {},
    koreadaily: {},
    all: {},
  };

  // Process each business
  for (const biz of businesses) {
    const keys = (biz.sourceKeys as SourceKey[]) || [];
    const sources = keys.map(k => k.source);
    const source = sources.includes('radiokorea')
      ? 'radiokorea'
      : sources.includes('koreadaily')
        ? 'koreadaily'
        : 'unknown';

    sourceCounters[source]++;

    const primarySlug = biz.primaryCategory?.slug || 'unknown';
    const subSlug = biz.subcategory?.slug || 'none';

    // Count by primary
    primaryBySource[source][primarySlug] = (primaryBySource[source][primarySlug] || 0) + 1;
    primaryBySource.all[primarySlug] = (primaryBySource.all[primarySlug] || 0) + 1;

    // Count by sub
    if (subSlug !== 'none') {
      subBySource[source][subSlug] = (subBySource[source][subSlug] || 0) + 1;
      subBySource.all[subSlug] = (subBySource.all[subSlug] || 0) + 1;
    }
  }

  result.summary.bySource = sourceCounters;
  result.summary.byPrimaryCategory = primaryBySource.all;
  result.primaryBySource = primaryBySource;
  result.subBySource = subBySource;

  // Get top 50 subcategories per source
  for (const source of ['radiokorea', 'koreadaily', 'all']) {
    const sorted = Object.entries(subBySource[source])
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);

    // Get category names
    const slugs = sorted.map(([slug]) => slug);
    const categories = await prisma.category.findMany({
      where: { slug: { in: slugs } },
      select: { slug: true, nameKo: true },
    });
    const nameMap = new Map(categories.map(c => [c.slug, c.nameKo]));

    result.top50SubcategoriesBySource[source] = sorted.map(([slug, count]) => ({
      slug,
      nameKo: nameMap.get(slug) || slug,
      count,
    }));
  }

  // Detect spikes (subcategory with >20% of source total)
  for (const source of ['radiokorea', 'koreadaily']) {
    const sourceTotal = sourceCounters[source];
    for (const [slug, count] of Object.entries(subBySource[source])) {
      const percent = (count / sourceTotal) * 100;
      if (percent > 20) {
        result.spikes.push({
          category: slug,
          source,
          count,
          percentOfSource: Math.round(percent * 100) / 100,
        });
      }
    }
  }

  // Write JSON report
  const reportsDir = path.resolve(__dirname, '../reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(reportsDir, 'category_distribution.json'),
    JSON.stringify(result, null, 2)
  );

  // Write Markdown report
  let md = `# Category Distribution Audit\n\n`;
  md += `**Generated:** ${result.timestamp}\n\n`;
  md += `## Summary\n\n`;
  md += `| Metric | Value |\n|--------|-------|\n`;
  md += `| Total Businesses | ${result.summary.totalBusinesses.toLocaleString()} |\n`;
  md += `| RadioKorea | ${sourceCounters.radiokorea.toLocaleString()} |\n`;
  md += `| KoreaDaily | ${sourceCounters.koreadaily.toLocaleString()} |\n`;
  md += `| Unknown Source | ${sourceCounters.unknown.toLocaleString()} |\n\n`;

  md += `## Primary Categories by Source\n\n`;
  md += `| Category | RadioKorea | KoreaDaily | Total |\n`;
  md += `|----------|------------|------------|-------|\n`;
  const allPrimary = Object.keys(primaryBySource.all).sort();
  for (const slug of allPrimary) {
    md += `| ${slug} | ${(primaryBySource.radiokorea[slug] || 0).toLocaleString()} | ${(primaryBySource.koreadaily[slug] || 0).toLocaleString()} | ${primaryBySource.all[slug].toLocaleString()} |\n`;
  }

  md += `\n## Top 20 Subcategories (All Sources)\n\n`;
  md += `| Rank | Slug | Name (KO) | Count |\n`;
  md += `|------|------|-----------|-------|\n`;
  result.top50SubcategoriesBySource.all.slice(0, 20).forEach((cat, idx) => {
    md += `| ${idx + 1} | ${cat.slug} | ${cat.nameKo} | ${cat.count.toLocaleString()} |\n`;
  });

  if (result.spikes.length > 0) {
    md += `\n## ⚠️ Detected Spikes (>20% of source)\n\n`;
    md += `| Category | Source | Count | % of Source |\n`;
    md += `|----------|--------|-------|-------------|\n`;
    for (const spike of result.spikes) {
      md += `| ${spike.category} | ${spike.source} | ${spike.count.toLocaleString()} | ${spike.percentOfSource}% |\n`;
    }
  }

  fs.writeFileSync(path.join(reportsDir, 'category_distribution.md'), md);

  console.log('\nReports written to:');
  console.log('  - reports/category_distribution.json');
  console.log('  - reports/category_distribution.md');

  await prisma.$disconnect();
}

main().catch(console.error);
