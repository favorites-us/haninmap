import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import { GoogleAnalytics } from '@/components/analytics/GoogleAnalytics';
import { MobileNav } from '@/components/MobileNav';
import { Providers } from './providers';
import './globals.css';

const geistSans = localFont({
  src: './fonts/GeistVF.woff',
  variable: '--font-geist-sans',
  weight: '100 900',
});
const geistMono = localFont({
  src: './fonts/GeistMonoVF.woff',
  variable: '--font-geist-mono',
  weight: '100 900',
});

export const metadata: Metadata = {
  title: {
    template: '%s | Korean Business Directory',
    default: 'Korean Business Directory | Find Korean-Speaking Businesses',
  },
  description:
    'Find Korean-speaking doctors, dentists, lawyers, restaurants, and more. The most comprehensive directory of Korean businesses.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || 'https://www.haninmap.com'),
  twitter: {
    card: 'summary',
  },
  openGraph: {
    siteName: '한인맵 HaninMap',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <head>
        <script
          async
          src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-4866951344575541"
          crossOrigin="anonymous"
        />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white min-h-screen`}>
        <GoogleAnalytics />
        <Providers>
          <Header />
          {children}
          <Footer />
        </Providers>
      </body>
    </html>
  );
}

function Header() {
  return (
    <header className="relative border-b border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between">
        <Link href="/" className="text-2xl font-bold text-gray-900">
          한인맵
        </Link>
        <nav className="hidden md:flex items-center gap-6 text-sm">
          <Link href="/regions" className="text-gray-600 hover:text-gray-900">
            전체 지역 (Regions)
          </Link>
          <Link href="/ca/los-angeles/medical" className="text-gray-600 hover:text-gray-900">
            병원 (Medical)
          </Link>
          <Link href="/ca/los-angeles/food" className="text-gray-600 hover:text-gray-900">
            식당 (Dining)
          </Link>
          <Link href="/canada/on/toronto/medical" className="text-gray-600 hover:text-gray-900">
            캐나다 (Canada)
          </Link>
          <Link href="/australia/nsw/sydney/medical" className="text-gray-600 hover:text-gray-900">
            호주 (Australia)
          </Link>
          <Link href="/alerts" className="text-gray-600 hover:text-gray-900">
            알림 (Alerts)
          </Link>
        </nav>
        <MobileNav />
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-gray-200 mt-12 py-8 bg-gray-50">
      <div className="max-w-6xl mx-auto px-4">
        <div className="grid md:grid-cols-4 gap-8">
          <div>
            <h3 className="font-semibold text-gray-900 mb-3">한인맵 HaninMap</h3>
            <p className="text-sm text-gray-600">
              미국, 캐나다, 호주 한인 업소를 쉽게 찾아보세요.
              <br />
              Find Korean-speaking professionals and businesses worldwide.
            </p>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-3">카테고리 (Categories)</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/ca/los-angeles/medical" className="text-gray-600 hover:text-gray-900">병원 (Medical)</Link></li>
              <li><Link href="/ca/los-angeles/dental" className="text-gray-600 hover:text-gray-900">치과 (Dental)</Link></li>
              <li><Link href="/ca/los-angeles/legal" className="text-gray-600 hover:text-gray-900">법률 (Legal)</Link></li>
              <li><Link href="/ca/los-angeles/insurance" className="text-gray-600 hover:text-gray-900">보험 (Insurance)</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-3">인기 도시 (Popular Cities)</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/ca/los-angeles/medical" className="text-gray-600 hover:text-gray-900">Los Angeles (로스앤젤레스)</Link></li>
              <li><Link href="/ca/irvine/medical" className="text-gray-600 hover:text-gray-900">Irvine (어바인)</Link></li>
              <li><Link href="/canada/on/toronto/medical" className="text-gray-600 hover:text-gray-900">Toronto (토론토)</Link></li>
              <li><Link href="/australia/nsw/sydney/medical" className="text-gray-600 hover:text-gray-900">Sydney (시드니)</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium text-gray-900 mb-3">바로가기 (Quick Links)</h4>
            <ul className="space-y-2 text-sm">
              <li><Link href="/regions" className="text-gray-600 hover:text-gray-900">전체 지역 (All Regions)</Link></li>
              <li><Link href="/guides" className="text-gray-600 hover:text-gray-900">가이드 (Guides)</Link></li>
              <li><Link href="/alerts" className="text-gray-600 hover:text-gray-900">생활 알림 (Alerts)</Link></li>
              <li><Link href="/privacy" className="text-gray-600 hover:text-gray-900">개인정보처리방침 (Privacy)</Link></li>
              <li><Link href="/terms" className="text-gray-600 hover:text-gray-900">이용약관 (Terms)</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-8 border-t border-gray-200 text-center text-sm text-gray-500">
          © {new Date().getFullYear()} 한인맵 HaninMap. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
