/**
 * Import Google Places enrichment data from HaninDoc into HaninMap
 *
 * This script:
 * 1. Fetches enriched businesses from HaninDoc Supabase
 * 2. Matches them to HaninMap businesses by phone number or name
 * 3. Imports the enrichment data without making any Google API calls
 *
 * Usage: npm run enrich:import-hanindoc
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// HaninDoc Supabase config
const HANINDOC_URL = 'https://ltabbyecozsxcqxqqvcq.supabase.co';
const HANINDOC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0YWJieWVjb3pzeGNxeHFxdmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NDIyNTMsImV4cCI6MjA4MzQxODI1M30.uTopD9pRXPd0WBgoyMyfmBGrrHh0y-Lype7RY--AH-4';

interface HaninDocBusiness {
  id: string;
  name_ko: string;
  name_en: string | null;
  phone_formatted: string | null;
  phone_international: string | null;
  formatted_address: string | null;
  google_place_id: string;
  google_rating: number | null;
  google_user_ratings_total: number | null;
  google_opening_hours: {
    periods?: Array<{
      open: { day: number; time: string };
      close: { day: number; time: string };
    }>;
    open_now?: boolean;
    weekday_text?: string[];
  } | null;
  google_photos: Array<{
    url: string;
    width: number;
    height: number;
    html_attributions?: string[];
  }> | null;
  google_maps_url: string | null;
  editorial_summary: string | null;
  website_url: string | null;
  last_google_sync: string | null;
  location: string | null; // PostGIS format
}

interface MatchResult {
  haninDocId: string;
  haninMapId: number;
  matchMethod: 'phone' | 'name_exact' | 'name_fuzzy' | 'address';
  confidence: number;
}

interface ImportStats {
  totalHaninDoc: number;
  withEnrichment: number;
  matched: number;
  imported: number;
  skipped: number;
  errors: number;
  byMatchMethod: Record<string, number>;
}

/**
 * Normalize phone number for matching
 */
function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Remove all non-digits
  const digits = phone.replace(/\D/g, '');
  // Return last 10 digits (US format)
  if (digits.length >= 10) {
    return digits.slice(-10);
  }
  return digits.length > 0 ? digits : null;
}

/**
 * Normalize name for matching
 */
function normalizeName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .toLowerCase()
    .replace(/[^\w\s가-힣]/g, '') // Keep alphanumeric, spaces, and Korean
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Fetch enriched businesses from HaninDoc
 */
async function fetchHaninDocBusinesses(): Promise<HaninDocBusiness[]> {
  const allBusinesses: HaninDocBusiness[] = [];
  let offset = 0;
  const limit = 1000;

  console.log('Fetching enriched businesses from HaninDoc...');

  while (true) {
    const url = `${HANINDOC_URL}/rest/v1/businesses?google_place_id=not.is.null&select=id,name_ko,name_en,phone_formatted,phone_international,formatted_address,google_place_id,google_rating,google_user_ratings_total,google_opening_hours,google_photos,google_maps_url,editorial_summary,website_url,last_google_sync,location&offset=${offset}&limit=${limit}`;

    const response = await fetch(url, {
      headers: {
        'apikey': HANINDOC_KEY,
        'Authorization': `Bearer ${HANINDOC_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HaninDoc API error: ${response.status}`);
    }

    const batch: HaninDocBusiness[] = await response.json();

    if (batch.length === 0) break;

    allBusinesses.push(...batch);
    console.log(`  Fetched ${allBusinesses.length} businesses...`);

    if (batch.length < limit) break;
    offset += limit;
  }

  return allBusinesses;
}

/**
 * Build phone index for HaninMap businesses
 */
async function buildPhoneIndex(): Promise<Map<string, number>> {
  console.log('Building phone index for HaninMap businesses...');

  const businesses = await prisma.business.findMany({
    where: {
      OR: [
        { phoneE164: { not: null } },
        { phoneRaw: { not: null } },
      ],
    },
    select: {
      id: true,
      phoneE164: true,
      phoneRaw: true,
    },
  });

  const phoneIndex = new Map<string, number>();

  for (const biz of businesses) {
    const normalized = normalizePhone(biz.phoneE164) || normalizePhone(biz.phoneRaw);
    if (normalized) {
      phoneIndex.set(normalized, biz.id);
    }
  }

  console.log(`  Built index with ${phoneIndex.size} phone numbers`);
  return phoneIndex;
}

/**
 * Build name index for HaninMap businesses
 */
async function buildNameIndex(): Promise<Map<string, number[]>> {
  console.log('Building name index for HaninMap businesses...');

  const businesses = await prisma.business.findMany({
    select: {
      id: true,
      nameKo: true,
      nameEn: true,
    },
  });

  const nameIndex = new Map<string, number[]>();

  for (const biz of businesses) {
    // Index by Korean name
    const normalizedKo = normalizeName(biz.nameKo);
    if (normalizedKo) {
      const existing = nameIndex.get(normalizedKo) || [];
      existing.push(biz.id);
      nameIndex.set(normalizedKo, existing);
    }

    // Index by English name
    if (biz.nameEn) {
      const normalizedEn = normalizeName(biz.nameEn);
      if (normalizedEn && normalizedEn !== normalizedKo) {
        const existing = nameIndex.get(normalizedEn) || [];
        existing.push(biz.id);
        nameIndex.set(normalizedEn, existing);
      }
    }
  }

  console.log(`  Built index with ${nameIndex.size} unique names`);
  return nameIndex;
}

/**
 * Match HaninDoc business to HaninMap business
 */
function matchBusiness(
  haninDoc: HaninDocBusiness,
  phoneIndex: Map<string, number>,
  nameIndex: Map<string, number[]>
): MatchResult | null {
  // Try phone match first (highest confidence)
  const phone = normalizePhone(haninDoc.phone_formatted) || normalizePhone(haninDoc.phone_international);
  if (phone) {
    const matchedId = phoneIndex.get(phone);
    if (matchedId) {
      return {
        haninDocId: haninDoc.id,
        haninMapId: matchedId,
        matchMethod: 'phone',
        confidence: 0.95,
      };
    }
  }

  // Try exact name match
  const nameKo = normalizeName(haninDoc.name_ko);
  const nameEn = normalizeName(haninDoc.name_en);

  if (nameKo) {
    const matches = nameIndex.get(nameKo);
    if (matches && matches.length === 1) {
      return {
        haninDocId: haninDoc.id,
        haninMapId: matches[0],
        matchMethod: 'name_exact',
        confidence: 0.85,
      };
    }
  }

  if (nameEn) {
    const matches = nameIndex.get(nameEn);
    if (matches && matches.length === 1) {
      return {
        haninDocId: haninDoc.id,
        haninMapId: matches[0],
        matchMethod: 'name_exact',
        confidence: 0.80,
      };
    }
  }

  return null;
}

/**
 * Import enrichment data for matched businesses
 */
async function importEnrichment(
  match: MatchResult,
  haninDoc: HaninDocBusiness
): Promise<boolean> {
  try {
    // Parse location if available
    let lat: number | null = null;
    let lng: number | null = null;

    if (haninDoc.location) {
      // Parse PostGIS POINT format: POINT(-118.123 34.456)
      const pointMatch = haninDoc.location.match(/POINT\(([-\d.]+)\s+([-\d.]+)\)/);
      if (pointMatch) {
        lng = parseFloat(pointMatch[1]);
        lat = parseFloat(pointMatch[2]);
      }
    }

    await prisma.googlePlace.upsert({
      where: { businessId: match.haninMapId },
      create: {
        businessId: match.haninMapId,
        placeId: haninDoc.google_place_id,
        rating: haninDoc.google_rating,
        userRatingsTotal: haninDoc.google_user_ratings_total,
        formattedAddress: haninDoc.formatted_address,
        lat,
        lng,
        openingHoursJson: haninDoc.google_opening_hours as object || undefined,
        openingHoursText: haninDoc.google_opening_hours?.weekday_text || undefined,
        website: haninDoc.website_url,
        phoneE164: haninDoc.phone_international,
        photosJson: haninDoc.google_photos as object[] || undefined,
        googleMapsUrl: haninDoc.google_maps_url,
        editorialSummary: haninDoc.editorial_summary,
        fetchStatus: 'ok',
        lastFetchedAt: haninDoc.last_google_sync ? new Date(haninDoc.last_google_sync) : new Date(),
        matchMethod: match.matchMethod,
        matchConfidence: match.confidence,
        sourceId: haninDoc.id,
      },
      update: {
        placeId: haninDoc.google_place_id,
        rating: haninDoc.google_rating,
        userRatingsTotal: haninDoc.google_user_ratings_total,
        formattedAddress: haninDoc.formatted_address,
        lat,
        lng,
        openingHoursJson: haninDoc.google_opening_hours as object || undefined,
        openingHoursText: haninDoc.google_opening_hours?.weekday_text || undefined,
        website: haninDoc.website_url,
        phoneE164: haninDoc.phone_international,
        photosJson: haninDoc.google_photos as object[] || undefined,
        googleMapsUrl: haninDoc.google_maps_url,
        editorialSummary: haninDoc.editorial_summary,
        fetchStatus: 'ok',
        lastFetchedAt: haninDoc.last_google_sync ? new Date(haninDoc.last_google_sync) : new Date(),
        matchMethod: match.matchMethod,
        matchConfidence: match.confidence,
        sourceId: haninDoc.id,
      },
    });

    // Update business lat/lng if missing
    if (lat && lng) {
      const business = await prisma.business.findUnique({
        where: { id: match.haninMapId },
        select: { lat: true, lng: true },
      });

      if (!business?.lat || !business?.lng) {
        await prisma.business.update({
          where: { id: match.haninMapId },
          data: { lat, lng },
        });
      }
    }

    return true;
  } catch (error) {
    console.error(`Error importing ${haninDoc.id}:`, error);
    return false;
  }
}

/**
 * Generate match report
 */
async function generateReport(
  stats: ImportStats,
  matches: MatchResult[],
  unmatched: HaninDocBusiness[]
): Promise<void> {
  const report = `# HaninDoc Enrichment Import Report

**Generated:** ${new Date().toISOString()}

## Summary

| Metric | Value |
|--------|-------|
| Total HaninDoc businesses | ${stats.totalHaninDoc} |
| With enrichment | ${stats.withEnrichment} |
| Matched to HaninMap | ${stats.matched} |
| Successfully imported | ${stats.imported} |
| Skipped (already exists) | ${stats.skipped} |
| Errors | ${stats.errors} |

## Match Methods

| Method | Count |
|--------|-------|
${Object.entries(stats.byMatchMethod).map(([method, count]) => `| ${method} | ${count} |`).join('\n')}

## Match Rate

- **Coverage:** ${((stats.matched / stats.withEnrichment) * 100).toFixed(1)}% of enriched HaninDoc businesses matched
- **Import Rate:** ${((stats.imported / stats.matched) * 100).toFixed(1)}% successfully imported

## Unmatched Samples (first 50)

| Name (KO) | Name (EN) | Phone | Address |
|-----------|-----------|-------|---------|
${unmatched.slice(0, 50).map(b => `| ${b.name_ko} | ${b.name_en || '-'} | ${b.phone_formatted || '-'} | ${(b.formatted_address || '').slice(0, 40)} |`).join('\n')}

## API Calls Made

**0** - All data imported from existing HaninDoc enrichment cache.
`;

  const fs = await import('fs');
  fs.writeFileSync('reports/enrichment_import_report.md', report);
  console.log('\nReport written to reports/enrichment_import_report.md');
}

async function main() {
  console.log('=== HaninDoc Enrichment Import ===\n');

  const stats: ImportStats = {
    totalHaninDoc: 0,
    withEnrichment: 0,
    matched: 0,
    imported: 0,
    skipped: 0,
    errors: 0,
    byMatchMethod: {},
  };

  try {
    // Step 1: Fetch HaninDoc data
    const haninDocBusinesses = await fetchHaninDocBusinesses();
    stats.totalHaninDoc = haninDocBusinesses.length;
    stats.withEnrichment = haninDocBusinesses.length; // Already filtered by google_place_id

    console.log(`\nFetched ${haninDocBusinesses.length} enriched businesses from HaninDoc`);

    // Step 2: Build indices
    const phoneIndex = await buildPhoneIndex();
    const nameIndex = await buildNameIndex();

    // Step 3: Match businesses
    console.log('\nMatching businesses...');
    const matches: MatchResult[] = [];
    const unmatched: HaninDocBusiness[] = [];

    for (const haninDoc of haninDocBusinesses) {
      const match = matchBusiness(haninDoc, phoneIndex, nameIndex);
      if (match) {
        matches.push(match);
        stats.byMatchMethod[match.matchMethod] = (stats.byMatchMethod[match.matchMethod] || 0) + 1;
      } else {
        unmatched.push(haninDoc);
      }
    }

    stats.matched = matches.length;
    console.log(`  Matched: ${matches.length} / ${haninDocBusinesses.length} (${((matches.length / haninDocBusinesses.length) * 100).toFixed(1)}%)`);

    // Step 4: Import enrichment data
    console.log('\nImporting enrichment data...');

    for (const match of matches) {
      const haninDoc = haninDocBusinesses.find(b => b.id === match.haninDocId)!;
      const success = await importEnrichment(match, haninDoc);

      if (success) {
        stats.imported++;
      } else {
        stats.errors++;
      }

      if ((stats.imported + stats.errors) % 100 === 0) {
        console.log(`  Progress: ${stats.imported + stats.errors} / ${matches.length}`);
      }
    }

    console.log(`\n=== Import Complete ===`);
    console.log(`Imported: ${stats.imported}`);
    console.log(`Errors: ${stats.errors}`);

    // Step 5: Generate report
    await generateReport(stats, matches, unmatched);

  } catch (error) {
    console.error('Import failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
