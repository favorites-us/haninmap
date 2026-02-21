'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useState } from 'react';
import { formatBilingual, UI_LABELS } from '@/lib/i18n/labels';
import { trackCallClick, trackDirectionsClick } from '@/lib/analytics/ga';

export interface BusinessCardProps {
  id: number;
  nameKo: string;
  nameEn?: string | null;
  addressRaw: string;
  city: string;
  state: string;
  phoneRaw?: string | null;
  phoneE164?: string | null;
  slug: string;
  rating?: number | null;
  reviewCount?: number | null;
  categorySlug: string;
  categoryNameEn: string;
  openNow?: boolean | null;
  trustScore?: number;
  communityMentions?: number;
  upVotes?: number;
  photoRef?: string | null;
  todayHours?: string | null;
}

export function BusinessCard({
  id,
  nameKo,
  nameEn,
  addressRaw,
  city,
  state,
  phoneRaw,
  phoneE164,
  slug,
  rating,
  reviewCount,
  categoryNameEn,
  openNow,
  trustScore,
  communityMentions,
  upVotes,
  photoRef,
  todayHours,
}: BusinessCardProps) {
  const [imgError, setImgError] = useState(false);
  const displayName = formatBilingual(nameKo, nameEn);

  const handleCallClick = () => {
    trackCallClick({
      phone: phoneE164 || phoneRaw || undefined,
      businessId: id,
      businessName: nameEn || nameKo,
      city,
      category: categoryNameEn,
    });
  };

  const handleDirectionsClick = () => {
    trackDirectionsClick({
      businessId: id,
      businessName: nameEn || nameKo,
      city,
      category: categoryNameEn,
      destination: addressRaw,
    });
  };

  const showPhoto = photoRef && !imgError;

  return (
    <article className="border border-gray-200 rounded-lg overflow-hidden hover:border-gray-300 hover:shadow-sm transition-all">
      <div className={showPhoto ? 'flex' : ''}>
        {showPhoto && (
          <div className="relative w-28 min-h-[7rem] shrink-0 bg-gray-100">
            <Image
              src={`/api/photo?ref=${encodeURIComponent(photoRef)}&maxwidth=200`}
              alt={nameKo}
              fill
              className="object-cover"
              sizes="112px"
              onError={() => setImgError(true)}
            />
          </div>
        )}

        <div className="flex-1 p-4 min-w-0">
          <Link href={`/biz/${slug}`} className="block">
            <h3 className="text-base font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate">
              {displayName}
            </h3>
          </Link>

          <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">{addressRaw}</p>

          <div className="flex items-center flex-wrap gap-x-3 gap-y-1 mt-2">
            {rating != null && reviewCount != null && (
              <div className="flex items-center text-sm">
                <span className="text-yellow-500 mr-0.5">★</span>
                <span className="font-medium">{rating.toFixed(1)}</span>
                <span className="text-gray-400 ml-0.5">({reviewCount})</span>
              </div>
            )}

            {openNow != null && (
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                openNow
                  ? 'bg-green-50 text-green-700'
                  : 'bg-red-50 text-red-600'
              }`}>
                {openNow ? '영업중' : '영업종료'}
              </span>
            )}

            {todayHours && (
              <span className="text-xs text-gray-400 truncate max-w-[180px]">
                {todayHours}
              </span>
            )}
          </div>

          {(trustScore || communityMentions || upVotes) ? (
            <div className="flex items-center flex-wrap gap-2 mt-1.5 text-xs">
              {trustScore != null && trustScore > 0 && (
                <span className={`font-medium px-2 py-0.5 rounded-full ${
                  trustScore >= 80
                    ? 'bg-green-50 text-green-700'
                    : trustScore >= 60
                      ? 'bg-yellow-50 text-yellow-700'
                      : 'bg-gray-100 text-gray-600'
                }`}>
                  신뢰 {trustScore}
                </span>
              )}
              {communityMentions != null && communityMentions > 0 && (
                <span className="text-gray-400">커뮤니티 {communityMentions}회</span>
              )}
              {upVotes != null && upVotes > 0 && (
                <span className="text-gray-400">👍 {upVotes}</span>
              )}
            </div>
          ) : null}

          <div className="flex items-center gap-2 mt-3">
            {phoneRaw && (
              <a
                href={`tel:${phoneE164 || phoneRaw}`}
                className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  handleCallClick();
                }}
              >
                📞 {UI_LABELS.call.ko}
              </a>
            )}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addressRaw)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-1.5 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                handleDirectionsClick();
              }}
            >
              🗺 {UI_LABELS.directions.ko}
            </a>
          </div>
        </div>
      </div>
    </article>
  );
}

export function BusinessCardSkeleton() {
  return (
    <div className="border border-gray-200 rounded-lg p-4 animate-pulse">
      <div className="h-5 bg-gray-200 rounded w-3/4"></div>
      <div className="h-4 bg-gray-200 rounded w-1/2 mt-2"></div>
      <div className="h-4 bg-gray-200 rounded w-full mt-3"></div>
      <div className="flex gap-2 mt-3">
        <div className="h-8 bg-gray-200 rounded w-16"></div>
        <div className="h-8 bg-gray-200 rounded w-16"></div>
      </div>
    </div>
  );
}
