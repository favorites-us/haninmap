import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import prisma from '@/lib/db/prisma';
import { FAQSection } from '@/components/FAQSection';
import { Breadcrumbs } from '@/components/Breadcrumbs';
import { JsonLd } from '@/components/JsonLd';
import { buildBreadcrumbList, buildFAQPageSchema, buildSpeakableSpec } from '@/lib/seo/meta';
import { PRIMARY_CATEGORIES } from '@/lib/taxonomy/categories';

export const revalidate = 86400; // 1 day

interface PageProps {
  params: Promise<{
    slug: string;
  }>;
}

async function getGuide(slug: string) {
  const guide = await prisma.guideContent.findUnique({
    where: {
      slug,
      status: 'published',
    },
  });

  return guide;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const guide = await getGuide(slug);

  if (!guide) return {};

  const title = `${guide.titleKo} | 한인맵 가이드`;
  const description = guide.summary.slice(0, 160);

  return {
    title,
    description,
    robots: 'index,follow',
    openGraph: {
      title,
      description,
      type: 'article',
      siteName: '한인맵 HaninMap',
      url: `https://www.haninmap.com/guides/${guide.slug}`,
      publishedTime: guide.publishedAt?.toISOString(),
      modifiedTime: guide.updatedAt.toISOString(),
    },
    twitter: {
      card: 'summary',
    },
    alternates: {
      canonical: `https://www.haninmap.com/guides/${guide.slug}`,
    },
  };
}

export default async function GuidePage({ params }: PageProps) {
  const { slug } = await params;
  const guide = await getGuide(slug);

  if (!guide) notFound();

  // Get category info
  const categoryInfo = PRIMARY_CATEGORIES.find(c => c.slug === guide.categorySlug);
  const categoryNameKo = categoryInfo?.nameKo || guide.categorySlug;

  // Parse FAQs
  const faqs = Array.isArray(guide.faqsJson)
    ? (guide.faqsJson as Array<{ question: string; answer: string }>)
    : [];

  // Parse tags
  const tags = Array.isArray(guide.tags)
    ? (guide.tags as string[])
    : [];

  // Parse source URLs
  const sourceUrls = Array.isArray(guide.sourceUrls)
    ? (guide.sourceUrls as string[])
    : [];

  // Breadcrumbs
  const breadcrumbItems = [
    { name: '홈 (Home)', url: 'https://www.haninmap.com' },
    { name: '가이드 (Guides)', url: 'https://www.haninmap.com/guides' },
    { name: guide.titleKo, url: `https://www.haninmap.com/guides/${guide.slug}` },
  ];
  const breadcrumbJsonLd = buildBreadcrumbList(breadcrumbItems);

  // Article JSON-LD
  const articleJsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.titleKo,
    description: guide.summary,
    datePublished: guide.publishedAt?.toISOString(),
    dateModified: guide.updatedAt.toISOString(),
    author: {
      '@type': 'Organization',
      name: '한인맵 HaninMap',
      url: 'https://www.haninmap.com',
    },
    publisher: {
      '@type': 'Organization',
      name: '한인맵 HaninMap',
      url: 'https://www.haninmap.com',
    },
    mainEntityOfPage: `https://www.haninmap.com/guides/${guide.slug}`,
    inLanguage: 'ko',
    speakable: buildSpeakableSpec(),
  };

  // FAQPage schema
  const faqJsonLd = faqs.length > 0 ? buildFAQPageSchema(faqs) : null;

  // Get related businesses (top 5 cities with most businesses in this category)
  const relatedBusinessStats = await prisma.business.groupBy({
    by: ['city', 'state'],
    where: {
      primaryCategory: {
        slug: guide.categorySlug,
      },
    },
    _count: {
      id: true,
    },
    orderBy: {
      _count: {
        id: 'desc',
      },
    },
    take: 5,
  });

  return (
    <>
      <JsonLd data={breadcrumbJsonLd} />
      <JsonLd data={articleJsonLd} />
      {faqJsonLd && <JsonLd data={faqJsonLd} />}

      <main className="max-w-4xl mx-auto px-4 py-8">
        {/* Breadcrumbs */}
        <Breadcrumbs items={breadcrumbItems} />

        {/* Header */}
        <header className="border-b border-gray-200 pb-6 mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">{guide.titleKo}</h1>

          {/* Tags */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-4">
              {tags.map((tag, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center px-3 py-1 bg-blue-50 text-blue-700 text-sm rounded-full"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* Summary */}
          <p className="text-lg text-gray-600 guide-summary">{guide.summary}</p>

          {/* Metadata */}
          <div className="flex items-center gap-4 mt-4 text-sm text-gray-500">
            <span>카테고리: {categoryNameKo}</span>
            {guide.publishedAt && (
              <time dateTime={guide.publishedAt.toISOString()}>
                발행일: {new Date(guide.publishedAt).toLocaleDateString('ko-KR')}
              </time>
            )}
            {guide.updatedAt && guide.publishedAt && guide.updatedAt > guide.publishedAt && (
              <time dateTime={guide.updatedAt.toISOString()}>
                수정일: {new Date(guide.updatedAt).toLocaleDateString('ko-KR')}
              </time>
            )}
          </div>
        </header>

        {/* Main Content (Markdown) */}
        <article className="prose prose-lg max-w-none mb-12">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {guide.contentKo}
          </ReactMarkdown>
        </article>

        {/* FAQs */}
        {faqs.length > 0 && (
          <div className="guide-faq">
            <FAQSection faqs={faqs} />
          </div>
        )}

        {/* Related Businesses Section */}
        {relatedBusinessStats.length > 0 && (
          <section className="mt-12 border-t border-gray-200 pt-8">
            <h2 className="text-xl font-semibold text-gray-900 mb-4">
              관련 한인 {categoryNameKo} 찾기
            </h2>
            <div className="grid sm:grid-cols-2 gap-4">
              {relatedBusinessStats.map((stat) => {
                const citySlug = stat.city.toLowerCase().replace(/\s+/g, '-');
                const stateSlug = stat.state.toLowerCase();
                return (
                  <Link
                    key={`${stat.state}-${stat.city}`}
                    href={`/${stateSlug}/${citySlug}/${guide.categorySlug}`}
                    className="block p-4 border border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-colors"
                  >
                    <div className="font-medium text-gray-900">
                      {toTitleCase(stat.city)}, {stat.state.toUpperCase()}
                    </div>
                    <div className="text-sm text-gray-600 mt-1">
                      한인 {categoryNameKo} {stat._count.id}곳 →
                    </div>
                  </Link>
                );
              })}
            </div>
          </section>
        )}

        {/* Sources Footer */}
        {sourceUrls.length > 0 && (
          <footer className="mt-12 pt-8 border-t border-gray-200">
            <h3 className="text-sm font-semibold text-gray-500 mb-2">참고 자료 (Sources)</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              {sourceUrls.map((url, idx) => (
                <li key={idx}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:text-blue-800 hover:underline"
                  >
                    {url}
                  </a>
                </li>
              ))}
            </ul>
          </footer>
        )}
      </main>
    </>
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
