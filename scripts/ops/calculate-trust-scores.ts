/**
 * Calculate trust scores for all businesses.
 * Combines community mentions, external ratings, engagement, and reviews
 * into a 0-100 composite score with per-category ranking.
 *
 * Run: npx tsx scripts/calculate-trust-scores.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Safe log-scale transform: log(1 + x) */
function logScale(x: number): number {
  return Math.log(1 + x);
}

/** Percentile-based normalization: returns value scaled 0..maxPoints
 *  where the top-percentile threshold maps to maxPoints. */
function percentileNormalize(
  value: number,
  topThreshold: number,
  maxPoints: number,
): number {
  if (topThreshold <= 0) return 0;
  return Math.min(maxPoints, (value / topThreshold) * maxPoints);
}

/** Compute the value at a given percentile (0-1) from a sorted array. */
function percentileValue(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil(p * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---------------------------------------------------------------------------
// Score calculators
// ---------------------------------------------------------------------------

interface MentionMap {
  [source: string]: { mentionCount: number; externalRating?: number | null; externalReviewCount?: number | null };
}

function computeWeightedMentionSum(mentions: MentionMap): number {
  const weights: Record<string, number> = {
    radiokorea: 3.0,
    heykorean: 3.0,
    missyusa: 2.5,
    reddit: 1.0,
    instagram: 0.3,
  };
  let sum = 0;
  for (const [source, weight] of Object.entries(weights)) {
    if (mentions[source]) {
      sum += mentions[source].mentionCount * weight;
    }
  }
  return sum;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Trust Score Calculator ===\n`);

  // -----------------------------------------------------------------------
  // 1. Load all businesses (with their primaryCategoryId)
  // -----------------------------------------------------------------------
  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      primaryCategoryId: true,
      googlePlace: {
        select: {
          rating: true,
          userRatingsTotal: true,
        },
      },
    },
  });
  console.log(`Loaded ${businesses.length} businesses.`);

  const bizIds = businesses.map((b) => String(b.id));
  const bizMap = new Map(businesses.map((b) => [String(b.id), b]));

  // -----------------------------------------------------------------------
  // 2. Load community mentions
  // -----------------------------------------------------------------------
  const allMentions = await prisma.communityMention.findMany({
    where: { businessId: { in: bizIds } },
  });

  // Group by businessId
  const mentionsByBiz = new Map<string, MentionMap>();
  for (const m of allMentions) {
    if (!mentionsByBiz.has(m.businessId)) {
      mentionsByBiz.set(m.businessId, {});
    }
    mentionsByBiz.get(m.businessId)![m.source] = {
      mentionCount: m.mentionCount,
      externalRating: m.externalRating,
      externalReviewCount: m.externalReviewCount,
    };
  }
  console.log(`Loaded ${allMentions.length} community mentions.`);

  // -----------------------------------------------------------------------
  // 3. Load engagement events (last 30 days)
  // -----------------------------------------------------------------------
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const engagementRows: Array<{ businessId: string; eventType: string; cnt: bigint }> =
    await prisma.$queryRaw`
      SELECT "businessId", "eventType", COUNT(*)::bigint AS cnt
      FROM "BusinessEngagement"
      WHERE "createdAt" >= ${thirtyDaysAgo}
      GROUP BY "businessId", "eventType"
    `;

  const engagementByBiz = new Map<string, Record<string, number>>();
  for (const row of engagementRows) {
    if (!engagementByBiz.has(row.businessId)) {
      engagementByBiz.set(row.businessId, {});
    }
    engagementByBiz.get(row.businessId)![row.eventType] = Number(row.cnt);
  }
  console.log(`Loaded engagement data for ${engagementByBiz.size} businesses.`);

  // -----------------------------------------------------------------------
  // 4. Load reviews
  // -----------------------------------------------------------------------
  const reviewRows: Array<{ businessId: string; avgRating: number; reviewCount: bigint }> =
    await prisma.$queryRaw`
      SELECT "businessId",
             AVG(rating)::float AS "avgRating",
             COUNT(*)::bigint AS "reviewCount"
      FROM "Review"
      WHERE status = 'active'
      GROUP BY "businessId"
    `;

  const reviewByBiz = new Map<
    string,
    { avgRating: number; reviewCount: number }
  >();
  for (const row of reviewRows) {
    reviewByBiz.set(row.businessId, {
      avgRating: row.avgRating,
      reviewCount: Number(row.reviewCount),
    });
  }
  console.log(`Loaded review data for ${reviewByBiz.size} businesses.`);

  // -----------------------------------------------------------------------
  // 5. Load votes
  // -----------------------------------------------------------------------
  const voteRows: Array<{ businessId: string; voteType: string; cnt: bigint }> =
    await prisma.$queryRaw`
      SELECT "businessId", "voteType", COUNT(*)::bigint AS cnt
      FROM "BusinessVote"
      GROUP BY "businessId", "voteType"
    `;

  const votesByBiz = new Map<string, { up: number; down: number }>();
  for (const row of voteRows) {
    if (!votesByBiz.has(row.businessId)) {
      votesByBiz.set(row.businessId, { up: 0, down: 0 });
    }
    if (row.voteType === 'up') {
      votesByBiz.get(row.businessId)!.up = Number(row.cnt);
    } else if (row.voteType === 'down') {
      votesByBiz.get(row.businessId)!.down = Number(row.cnt);
    }
  }
  console.log(`Loaded vote data for ${votesByBiz.size} businesses.`);

  // -----------------------------------------------------------------------
  // 6. Compute raw scores & determine normalization thresholds
  // -----------------------------------------------------------------------

  // Find max Google reviews & max Yelp reviews for external score normalization
  let maxGoogleReviews = 0;
  let maxYelpReviews = 0;
  for (const biz of businesses) {
    if (biz.googlePlace?.userRatingsTotal) {
      maxGoogleReviews = Math.max(maxGoogleReviews, biz.googlePlace.userRatingsTotal);
    }
  }
  for (const [, mentions] of mentionsByBiz) {
    if (mentions.yelp?.externalReviewCount) {
      maxYelpReviews = Math.max(maxYelpReviews, mentions.yelp.externalReviewCount);
    }
  }
  console.log(`Max Google reviews: ${maxGoogleReviews}, Max Yelp reviews: ${maxYelpReviews}`);

  // First pass: compute raw community & engagement values for percentile normalization
  const rawCommunityScores: number[] = [];
  const rawEngagementScores: number[] = [];

  const engagementWeights: Record<string, number> = {
    phone_click: 5,
    website_click: 3,
    guide_click: 2,
    view: 0.1,
  };

  for (const biz of businesses) {
    const bizId = String(biz.id);

    // Community raw weighted sum
    const mentions = mentionsByBiz.get(bizId) || {};
    const weightedSum = computeWeightedMentionSum(mentions);
    rawCommunityScores.push(logScale(weightedSum));

    // Engagement raw weighted sum
    const eng = engagementByBiz.get(bizId) || {};
    let engSum = 0;
    for (const [type, weight] of Object.entries(engagementWeights)) {
      engSum += (eng[type] || 0) * weight;
    }
    rawEngagementScores.push(logScale(engSum));
  }

  // Sort for percentile calculation
  rawCommunityScores.sort((a, b) => a - b);
  rawEngagementScores.sort((a, b) => a - b);

  // Top 1% thresholds
  const communityTop1 = percentileValue(rawCommunityScores, 0.99);
  const engagementTop1 = percentileValue(rawEngagementScores, 0.99);

  console.log(
    `Community top 1% threshold: ${communityTop1.toFixed(4)}, ` +
    `Engagement top 1% threshold: ${engagementTop1.toFixed(4)}`,
  );

  // -----------------------------------------------------------------------
  // 7. Compute final scores for each business
  // -----------------------------------------------------------------------

  interface ScoreRow {
    businessId: string;
    primaryCategoryId: number;
    communityScore: number;
    externalScore: number;
    engagementScore: number;
    reviewScore: number;
    totalScore: number;
  }

  const scoreRows: ScoreRow[] = [];

  for (const biz of businesses) {
    const bizId = String(biz.id);

    // --- communityScore (0-30) ---
    const mentions = mentionsByBiz.get(bizId) || {};
    const weightedSum = computeWeightedMentionSum(mentions);
    const communityScore = percentileNormalize(
      logScale(weightedSum),
      communityTop1,
      30,
    );

    // --- externalScore (0-25) ---
    // Yelp component (0-12.5)
    let yelpScore = 0;
    const yelpData = mentions.yelp;
    if (yelpData?.externalRating && yelpData.externalReviewCount) {
      const ratingFactor = yelpData.externalRating / 5;
      const volumeFactor =
        maxYelpReviews > 0
          ? logScale(yelpData.externalReviewCount) / logScale(maxYelpReviews)
          : 0;
      yelpScore = ratingFactor * volumeFactor * 12.5;
    }

    // Google component (0-12.5)
    let googleScore = 0;
    if (biz.googlePlace?.rating && biz.googlePlace.userRatingsTotal) {
      const ratingFactor = biz.googlePlace.rating / 5;
      const volumeFactor =
        maxGoogleReviews > 0
          ? logScale(biz.googlePlace.userRatingsTotal) / logScale(maxGoogleReviews)
          : 0;
      googleScore = ratingFactor * volumeFactor * 12.5;
    }

    const externalScore = yelpScore + googleScore;

    // --- engagementScore (0-30) ---
    const eng = engagementByBiz.get(bizId) || {};
    let engSum = 0;
    for (const [type, weight] of Object.entries(engagementWeights)) {
      engSum += (eng[type] || 0) * weight;
    }
    const engagementScore = percentileNormalize(
      logScale(engSum),
      engagementTop1,
      30,
    );

    // --- reviewScore (0-15) ---
    const review = reviewByBiz.get(bizId);
    const votes = votesByBiz.get(bizId);

    let reviewScore = 0;
    if (review) {
      // (avgRating/5) * min(reviewCount,10)/10 * 10
      const ratingPart =
        (review.avgRating / 5) *
        (Math.min(review.reviewCount, 10) / 10) *
        10;

      // upVoteRatio * 5 (only if min 3 votes)
      let votePart = 0;
      if (votes) {
        const totalVotes = votes.up + votes.down;
        if (totalVotes >= 3) {
          const upRatio = votes.up / totalVotes;
          votePart = upRatio * 5;
        }
      }

      reviewScore = ratingPart + votePart;
    }

    // --- totalScore (0-100) ---
    const totalScore = communityScore + externalScore + engagementScore + reviewScore;

    scoreRows.push({
      businessId: bizId,
      primaryCategoryId: biz.primaryCategoryId,
      communityScore: Math.round(communityScore * 100) / 100,
      externalScore: Math.round(externalScore * 100) / 100,
      engagementScore: Math.round(engagementScore * 100) / 100,
      reviewScore: Math.round(reviewScore * 100) / 100,
      totalScore: Math.round(totalScore * 100) / 100,
    });
  }

  // -----------------------------------------------------------------------
  // 8. Compute per-category rankings
  // -----------------------------------------------------------------------
  // Group by primaryCategoryId, sort by totalScore DESC, assign rank
  const byCategory = new Map<number, ScoreRow[]>();
  for (const row of scoreRows) {
    if (!byCategory.has(row.primaryCategoryId)) {
      byCategory.set(row.primaryCategoryId, []);
    }
    byCategory.get(row.primaryCategoryId)!.push(row);
  }

  const rankMap = new Map<string, number>(); // bizId -> rank
  for (const [, rows] of byCategory) {
    rows.sort((a, b) => b.totalScore - a.totalScore);
    rows.forEach((row, idx) => {
      rankMap.set(row.businessId, idx + 1);
    });
  }

  // -----------------------------------------------------------------------
  // 9. Upsert all scores into TrustScore table
  // -----------------------------------------------------------------------
  console.log(`\nUpserting ${scoreRows.length} trust scores...`);

  let upserted = 0;
  const now = new Date();

  // Batch upserts using transactions for performance
  const BATCH_SIZE = 500;
  for (let i = 0; i < scoreRows.length; i += BATCH_SIZE) {
    const batch = scoreRows.slice(i, i + BATCH_SIZE);
    await prisma.$transaction(
      batch.map((row) =>
        prisma.trustScore.upsert({
          where: { businessId: row.businessId },
          create: {
            businessId: row.businessId,
            communityScore: row.communityScore,
            externalScore: row.externalScore,
            engagementScore: row.engagementScore,
            reviewScore: row.reviewScore,
            totalScore: row.totalScore,
            rank: rankMap.get(row.businessId) ?? null,
            calculatedAt: now,
          },
          update: {
            communityScore: row.communityScore,
            externalScore: row.externalScore,
            engagementScore: row.engagementScore,
            reviewScore: row.reviewScore,
            totalScore: row.totalScore,
            rank: rankMap.get(row.businessId) ?? null,
            calculatedAt: now,
          },
        }),
      ),
    );
    upserted += batch.length;

    if (upserted % 5000 === 0 || upserted === scoreRows.length) {
      console.log(`  Upserted ${upserted}/${scoreRows.length}`);
    }
  }

  // -----------------------------------------------------------------------
  // 10. Print summary stats
  // -----------------------------------------------------------------------
  const totalScores = scoreRows.map((r) => r.totalScore).sort((a, b) => a - b);
  const communityScores = scoreRows.map((r) => r.communityScore).sort((a, b) => a - b);
  const externalScores = scoreRows.map((r) => r.externalScore).sort((a, b) => a - b);
  const engagementScores = scoreRows.map((r) => r.engagementScore).sort((a, b) => a - b);
  const reviewScores = scoreRows.map((r) => r.reviewScore).sort((a, b) => a - b);

  const avg = (arr: number[]) =>
    arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0;
  const median = (arr: number[]) =>
    arr.length > 0 ? arr[Math.floor(arr.length / 2)] : 0;
  const max = (arr: number[]) => (arr.length > 0 ? arr[arr.length - 1] : 0);

  console.log(`\n=== Trust Score Summary ===`);
  console.log(`Total businesses scored: ${scoreRows.length}`);
  console.log(`Categories with rankings: ${byCategory.size}`);
  console.log('');
  console.log(`                     Avg     Median     Max`);
  console.log(`  communityScore:  ${avg(communityScores).toFixed(2).padStart(6)}   ${median(communityScores).toFixed(2).padStart(6)}   ${max(communityScores).toFixed(2).padStart(6)}  (0-30)`);
  console.log(`  externalScore:   ${avg(externalScores).toFixed(2).padStart(6)}   ${median(externalScores).toFixed(2).padStart(6)}   ${max(externalScores).toFixed(2).padStart(6)}  (0-25)`);
  console.log(`  engagementScore: ${avg(engagementScores).toFixed(2).padStart(6)}   ${median(engagementScores).toFixed(2).padStart(6)}   ${max(engagementScores).toFixed(2).padStart(6)}  (0-30)`);
  console.log(`  reviewScore:     ${avg(reviewScores).toFixed(2).padStart(6)}   ${median(reviewScores).toFixed(2).padStart(6)}   ${max(reviewScores).toFixed(2).padStart(6)}  (0-15)`);
  console.log(`  totalScore:      ${avg(totalScores).toFixed(2).padStart(6)}   ${median(totalScores).toFixed(2).padStart(6)}   ${max(totalScores).toFixed(2).padStart(6)}  (0-100)`);

  // Distribution buckets
  const buckets = [
    { label: '0-10', min: 0, max: 10 },
    { label: '10-20', min: 10, max: 20 },
    { label: '20-30', min: 20, max: 30 },
    { label: '30-50', min: 30, max: 50 },
    { label: '50-70', min: 50, max: 70 },
    { label: '70-100', min: 70, max: 100 },
  ];
  console.log('\nScore distribution:');
  for (const bucket of buckets) {
    const count = totalScores.filter(
      (s) => s >= bucket.min && s < bucket.max,
    ).length;
    const pct = ((count / totalScores.length) * 100).toFixed(1);
    const bar = '#'.repeat(Math.round((count / totalScores.length) * 50));
    console.log(
      `  ${bucket.label.padEnd(6)}: ${String(count).padStart(6)} (${pct.padStart(5)}%) ${bar}`,
    );
  }

  // Top 10 businesses
  const top10 = scoreRows
    .sort((a, b) => b.totalScore - a.totalScore)
    .slice(0, 10);
  console.log('\nTop 10 businesses:');
  for (const row of top10) {
    const biz = bizMap.get(row.businessId);
    const nameKo = biz ? (biz as any).nameKo || bizMap.get(row.businessId) : row.businessId;
    console.log(
      `  #${rankMap.get(row.businessId)?.toString().padStart(3)} | ` +
      `total=${row.totalScore.toFixed(1).padStart(5)} | ` +
      `comm=${row.communityScore.toFixed(1).padStart(4)} ext=${row.externalScore.toFixed(1).padStart(4)} ` +
      `eng=${row.engagementScore.toFixed(1).padStart(4)} rev=${row.reviewScore.toFixed(1).padStart(4)} | ` +
      `bizId=${row.businessId}`,
    );
  }

  console.log(`\nDone.`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Trust score calculation failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
