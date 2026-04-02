import prisma from '@/lib/db/prisma';

interface TrustScoreDetailProps {
  businessId: number;
}

const SCORE_CATEGORIES = [
  { key: 'communityScore' as const, label: '커뮤니티 평판', max: 30, color: 'bg-blue-500' },
  { key: 'externalScore' as const, label: '외부 평점', max: 25, color: 'bg-purple-500' },
  { key: 'engagementScore' as const, label: '한인맵 관심도', max: 30, color: 'bg-green-500' },
  { key: 'reviewScore' as const, label: '리뷰 평가', max: 15, color: 'bg-orange-500' },
] as const;

function getTotalScoreColor(score: number): string {
  if (score >= 80) return 'text-green-600';
  if (score >= 60) return 'text-yellow-600';
  return 'text-red-500';
}

export async function TrustScoreDetail({ businessId }: TrustScoreDetailProps) {
  const trustScore = await prisma.trustScore.findUnique({
    where: { businessId },
  });

  if (!trustScore) return null;

  const totalColor = getTotalScoreColor(trustScore.totalScore);

  return (
    <section className="border border-gray-200 rounded-lg p-5 mb-6">
      {/* Header */}
      <div className="flex items-baseline justify-between mb-5">
        <h2 className="text-lg font-semibold text-gray-900">
          한인 신뢰점수{' '}
          <span className={`text-2xl font-bold ${totalColor}`}>
            {Math.round(trustScore.totalScore)}
          </span>
          <span className="text-gray-500 text-base font-normal">/100</span>
        </h2>
        {trustScore.rank != null && (
          <span className="text-sm text-gray-500">
            이 카테고리 <span className="font-semibold text-gray-700">{trustScore.rank}위</span>
          </span>
        )}
      </div>

      {/* Score Breakdown */}
      <div className="space-y-3">
        {SCORE_CATEGORIES.map(({ key, label, max, color }) => {
          const value = trustScore[key];
          const pct = Math.min((value / max) * 100, 100);

          return (
            <div key={key} className="flex items-center gap-3">
              <span className="text-sm text-gray-600 w-28 shrink-0">{label}</span>
              <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${color}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <span className="text-sm text-gray-500 w-12 text-right shrink-0">
                {Math.round(value)}/{max}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
