/**
 * Data ingestion script for Korean business directory
 * Run with: npx tsx scripts/ingest.ts
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

import { normalizePhone, parseAddress, generateSlug } from '../../src/lib/ingestion/normalize';
import { mapRadioKoreaCategory, mapKoreaDailyCategory } from '../../src/lib/taxonomy/categoryMapping';
import { getAllCategories } from '../../src/lib/taxonomy/categories';
import {
  findPotentialMatch,
  mergeSourceKeys,
  calculateQualityScore,
  SourceKey,
} from '../../src/lib/dedupe/dedupe';

const prisma = new PrismaClient();

// Data file paths (relative to project root)
const RADIOKOREA_FILE = path.resolve(__dirname, '../../radiokorea_businesses.json');
const KOREADAILY_FILE = path.resolve(__dirname, '../../scraped_koreadaily_yp_complete.json');

interface RadioKoreaBusiness {
  uid: string;
  dir: number;
  name: string;
  name_en?: string;
  phone?: string;
  address: string;
  category_code: string;
  category_name: string;
}

interface KoreaDailyBusiness {
  ypl_id: number;
  ypl_kname: string;
  ypl_ename?: string | null;
  ypl_addr: string;
  ypl_phone?: string | null;
  ypl_fax?: string | null;
  ypl_email?: string | null;
  ypl_web?: string | null;
  ypl_latitude?: number | null;
  ypl_longitude?: number | null;
  ypl_pic?: string | null;
  ypl_order?: number;
  review_cnt?: number | null;
  point_avg?: number | null;
  category_id: number;
  category_name: string;
  sub_idx?: number | null;
  sub_name?: string | null;
  region?: string;
}

async function seedCategories() {
  console.log('Seeding categories...');

  const categories = getAllCategories();
  const categoryIdMap: Record<string, number> = {};

  // First, insert all primary categories
  for (const cat of categories.filter((c) => c.level === 'primary')) {
    const existing = await prisma.category.findUnique({ where: { slug: cat.slug } });
    if (existing) {
      categoryIdMap[cat.slug] = existing.id;
    } else {
      const created = await prisma.category.create({
        data: {
          slug: cat.slug,
          nameKo: cat.nameKo,
          nameEn: cat.nameEn,
          level: cat.level,
        },
      });
      categoryIdMap[cat.slug] = created.id;
    }
  }

  // Then, insert subcategories with parent reference
  for (const cat of categories.filter((c) => c.level === 'sub')) {
    const existing = await prisma.category.findUnique({ where: { slug: cat.slug } });
    if (existing) {
      categoryIdMap[cat.slug] = existing.id;
    } else {
      const parentId = cat.parentSlug ? categoryIdMap[cat.parentSlug] : null;
      const created = await prisma.category.create({
        data: {
          slug: cat.slug,
          nameKo: cat.nameKo,
          nameEn: cat.nameEn,
          level: cat.level,
          parentId,
        },
      });
      categoryIdMap[cat.slug] = created.id;
    }
  }

  console.log(`Seeded ${Object.keys(categoryIdMap).length} categories`);
  return categoryIdMap;
}

async function ingestRadioKorea(categoryIdMap: Record<string, number>) {
  console.log('Ingesting RadioKorea data...');

  const rawData = fs.readFileSync(RADIOKOREA_FILE, 'utf-8');
  const data = JSON.parse(rawData);
  const businesses: RadioKoreaBusiness[] = data.businesses || [];

  console.log(`Found ${businesses.length} businesses in RadioKorea data`);

  let processed = 0;
  let skipped = 0;
  let deduped = 0;

  for (const biz of businesses) {
    try {
      // Normalize phone
      const { e164: phoneE164, raw: phoneRaw } = normalizePhone(biz.phone);

      // Parse and normalize address
      const addressParsed = parseAddress(biz.address);

      // Map category
      const categoryMapping = mapRadioKoreaCategory(biz.category_code);
      const primaryCategoryId = categoryIdMap[categoryMapping.primary];
      const subcategoryId = categoryMapping.sub ? categoryIdMap[categoryMapping.sub] : null;

      if (!primaryCategoryId) {
        console.warn(`Unknown primary category: ${categoryMapping.primary} for ${biz.category_code}`);
        skipped++;
        continue;
      }

      if (!addressParsed.city) {
        // Skip records without a recognizable city
        skipped++;
        continue;
      }

      const sourceKeys: SourceKey[] = [{ source: 'radiokorea', uid: biz.uid }];

      // Check for potential duplicates
      const potentialMatches = await prisma.business.findMany({
        where: {
          OR: [
            phoneE164 ? { phoneE164 } : {},
            { city: addressParsed.city, addressNorm: { not: null } },
          ].filter((o) => Object.keys(o).length > 0),
        },
        select: {
          id: true,
          nameKo: true,
          nameEn: true,
          phoneE164: true,
          addressNorm: true,
          zip: true,
          dedupeClusterId: true,
          sourceKeys: true,
          qualityScore: true,
        },
      });

      const match = findPotentialMatch(
        {
          nameKo: biz.name,
          nameEn: biz.name_en || null,
          phoneE164,
          addressNorm: addressParsed.normalized,
          zip: addressParsed.zip,
        },
        potentialMatches.map((m) => ({
          ...m,
          nameEn: m.nameEn || null,
          phoneE164: m.phoneE164 || null,
          addressNorm: m.addressNorm || null,
          zip: m.zip || null,
        }))
      );

      if (match) {
        // Update existing record with merged data
        const existingRecord = potentialMatches.find(
          (m) => m.dedupeClusterId === match.clusterId || m.id === match.clusterId
        );

        if (existingRecord) {
          const existingSourceKeys = (existingRecord.sourceKeys as unknown as SourceKey[]) || [];
          const mergedSourceKeys = mergeSourceKeys(existingSourceKeys, sourceKeys);

          const newQualityScore = calculateQualityScore({
            nameEn: biz.name_en || existingRecord.nameEn,
            phoneE164: phoneE164 || existingRecord.phoneE164,
            addressNorm: addressParsed.normalized || existingRecord.addressNorm,
            lat: null,
            lng: null,
            zip: addressParsed.zip || existingRecord.zip,
            sourceKeys: mergedSourceKeys,
          });

          // Only update if new data improves quality
          if (newQualityScore > existingRecord.qualityScore) {
            await prisma.business.update({
              where: { id: existingRecord.id },
              data: {
                nameEn: biz.name_en || existingRecord.nameEn,
                phoneE164: phoneE164 || existingRecord.phoneE164,
                addressNorm: addressParsed.normalized || existingRecord.addressNorm,
                sourceKeys: mergedSourceKeys as unknown as object,
                qualityScore: newQualityScore,
              },
            });
          } else {
            // Just merge source keys
            await prisma.business.update({
              where: { id: existingRecord.id },
              data: {
                sourceKeys: mergedSourceKeys as unknown as object,
              },
            });
          }

          deduped++;
          continue;
        }
      }

      // Create new record
      const qualityScore = calculateQualityScore({
        nameEn: biz.name_en || null,
        phoneE164,
        addressNorm: addressParsed.normalized,
        lat: null,
        lng: null,
        zip: addressParsed.zip,
        sourceKeys,
      });

      const newBusiness = await prisma.business.create({
        data: {
          nameKo: biz.name,
          nameEn: biz.name_en || null,
          phoneE164,
          phoneRaw,
          addressRaw: biz.address,
          addressNorm: addressParsed.normalized,
          city: addressParsed.city,
          state: addressParsed.state,
          zip: addressParsed.zip,
          primaryCategoryId,
          subcategoryId,
          sourceKeys: sourceKeys as unknown as object,
          qualityScore,
        },
      });

      // Set dedupeClusterId to its own ID (will be updated if duplicates found later)
      await prisma.business.update({
        where: { id: newBusiness.id },
        data: {
          dedupeClusterId: newBusiness.id,
          slug: generateSlug(biz.name, biz.name_en, newBusiness.id),
        },
      });

      processed++;

      if (processed % 1000 === 0) {
        console.log(`  Processed ${processed} RadioKorea businesses...`);
      }
    } catch (error) {
      console.error(`Error processing RadioKorea business ${biz.uid}:`, error);
      skipped++;
    }
  }

  console.log(`RadioKorea: Processed ${processed}, Skipped ${skipped}, Deduped ${deduped}`);
}

async function ingestKoreaDaily(categoryIdMap: Record<string, number>) {
  console.log('Ingesting KoreaDaily data...');

  const rawData = fs.readFileSync(KOREADAILY_FILE, 'utf-8');
  const businesses: KoreaDailyBusiness[] = JSON.parse(rawData);

  console.log(`Found ${businesses.length} businesses in KoreaDaily data`);

  let processed = 0;
  let skipped = 0;
  let deduped = 0;

  for (const biz of businesses) {
    try {
      // Normalize phone
      const { e164: phoneE164, raw: phoneRaw } = normalizePhone(biz.ypl_phone || null);

      // Parse and normalize address
      const addressParsed = parseAddress(biz.ypl_addr);

      // Map category
      const categoryMapping = mapKoreaDailyCategory(biz.category_id, biz.sub_idx || undefined);
      const primaryCategoryId = categoryIdMap[categoryMapping.primary];
      const subcategoryId = categoryMapping.sub ? categoryIdMap[categoryMapping.sub] : null;

      if (!primaryCategoryId) {
        console.warn(`Unknown primary category: ${categoryMapping.primary} for ${biz.category_id}`);
        skipped++;
        continue;
      }

      if (!addressParsed.city) {
        skipped++;
        continue;
      }

      const sourceKeys: SourceKey[] = [{ source: 'koreadaily', uid: String(biz.ypl_id) }];

      // Check for potential duplicates
      const potentialMatches = await prisma.business.findMany({
        where: {
          OR: [
            phoneE164 ? { phoneE164 } : {},
            { city: addressParsed.city, addressNorm: { not: null } },
          ].filter((o) => Object.keys(o).length > 0),
        },
        select: {
          id: true,
          nameKo: true,
          nameEn: true,
          phoneE164: true,
          addressNorm: true,
          zip: true,
          dedupeClusterId: true,
          sourceKeys: true,
          qualityScore: true,
          lat: true,
          lng: true,
        },
      });

      const match = findPotentialMatch(
        {
          nameKo: biz.ypl_kname,
          nameEn: biz.ypl_ename || null,
          phoneE164,
          addressNorm: addressParsed.normalized,
          zip: addressParsed.zip,
        },
        potentialMatches.map((m) => ({
          ...m,
          nameEn: m.nameEn || null,
          phoneE164: m.phoneE164 || null,
          addressNorm: m.addressNorm || null,
          zip: m.zip || null,
        }))
      );

      if (match) {
        const existingRecord = potentialMatches.find(
          (m) => m.dedupeClusterId === match.clusterId || m.id === match.clusterId
        );

        if (existingRecord) {
          const existingSourceKeys = (existingRecord.sourceKeys as unknown as SourceKey[]) || [];
          const mergedSourceKeys = mergeSourceKeys(existingSourceKeys, sourceKeys);

          // KoreaDaily often has lat/lng which is valuable
          const lat = biz.ypl_latitude || existingRecord.lat;
          const lng = biz.ypl_longitude || existingRecord.lng;

          const newQualityScore = calculateQualityScore({
            nameEn: biz.ypl_ename || existingRecord.nameEn,
            phoneE164: phoneE164 || existingRecord.phoneE164,
            addressNorm: addressParsed.normalized || existingRecord.addressNorm,
            lat,
            lng,
            zip: addressParsed.zip || existingRecord.zip,
            sourceKeys: mergedSourceKeys,
          });

          await prisma.business.update({
            where: { id: existingRecord.id },
            data: {
              nameEn: biz.ypl_ename || existingRecord.nameEn,
              phoneE164: phoneE164 || existingRecord.phoneE164,
              addressNorm: addressParsed.normalized || existingRecord.addressNorm,
              lat,
              lng,
              sourceKeys: mergedSourceKeys as unknown as object,
              qualityScore: newQualityScore,
            },
          });

          deduped++;
          continue;
        }
      }

      // Create new record
      const qualityScore = calculateQualityScore({
        nameEn: biz.ypl_ename || null,
        phoneE164,
        addressNorm: addressParsed.normalized,
        lat: biz.ypl_latitude || null,
        lng: biz.ypl_longitude || null,
        zip: addressParsed.zip,
        sourceKeys,
      });

      const newBusiness = await prisma.business.create({
        data: {
          nameKo: biz.ypl_kname,
          nameEn: biz.ypl_ename || null,
          phoneE164,
          phoneRaw,
          addressRaw: biz.ypl_addr,
          addressNorm: addressParsed.normalized,
          city: addressParsed.city,
          state: addressParsed.state,
          zip: addressParsed.zip,
          lat: biz.ypl_latitude || null,
          lng: biz.ypl_longitude || null,
          primaryCategoryId,
          subcategoryId,
          sourceKeys: sourceKeys as unknown as object,
          qualityScore,
        },
      });

      await prisma.business.update({
        where: { id: newBusiness.id },
        data: {
          dedupeClusterId: newBusiness.id,
          slug: generateSlug(biz.ypl_kname, biz.ypl_ename, newBusiness.id),
        },
      });

      processed++;

      if (processed % 1000 === 0) {
        console.log(`  Processed ${processed} KoreaDaily businesses...`);
      }
    } catch (error) {
      console.error(`Error processing KoreaDaily business ${biz.ypl_id}:`, error);
      skipped++;
    }
  }

  console.log(`KoreaDaily: Processed ${processed}, Skipped ${skipped}, Deduped ${deduped}`);
}

async function main() {
  console.log('Starting data ingestion...\n');

  try {
    // Seed categories first
    const categoryIdMap = await seedCategories();

    // Ingest RadioKorea data
    await ingestRadioKorea(categoryIdMap);

    // Ingest KoreaDaily data
    await ingestKoreaDaily(categoryIdMap);

    // Print summary
    const totalBusinesses = await prisma.business.count();
    const uniqueClusters = await prisma.business.groupBy({
      by: ['dedupeClusterId'],
    });

    console.log('\n=== Ingestion Summary ===');
    console.log(`Total business records: ${totalBusinesses}`);
    console.log(`Unique businesses (clusters): ${uniqueClusters.length}`);
    console.log(`Duplicate records merged: ${totalBusinesses - uniqueClusters.length}`);
  } catch (error) {
    console.error('Ingestion failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
