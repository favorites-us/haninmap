/**
 * Sync HaninDoc slugs into HaninMap Business records.
 * Matches by: GooglePlace.sourceId (HaninDoc UUID) → phone → name.
 *
 * Usage: npx tsx scripts/data/sync-hanindoc-slugs.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const HANINDOC_URL = 'https://ltabbyecozsxcqxqqvcq.supabase.co';
const HANINDOC_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx0YWJieWVjb3pzeGNxeHFxdmNxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc4NDIyNTMsImV4cCI6MjA4MzQxODI1M30.uTopD9pRXPd0WBgoyMyfmBGrrHh0y-Lype7RY--AH-4';

interface HanindocBiz {
  id: string;
  slug: string;
  name_ko: string;
  name_en: string | null;
  phone_formatted: string | null;
  phone_international: string | null;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : null;
}

async function main() {
  console.log('=== HaninDoc Slug Sync ===\n');

  // 1. Fetch all HaninDoc businesses with slugs
  console.log('Fetching HaninDoc businesses...');
  const res = await fetch(
    `${HANINDOC_URL}/rest/v1/businesses?select=id,slug,name_ko,name_en,phone_formatted,phone_international&slug=not.is.null`,
    { headers: { apikey: HANINDOC_KEY, Authorization: `Bearer ${HANINDOC_KEY}` } },
  );
  if (!res.ok) throw new Error(`HaninDoc fetch failed: ${res.status}`);
  const hanindocBizs: HanindocBiz[] = await res.json();
  console.log(`  Loaded ${hanindocBizs.length} HaninDoc businesses with slugs.`);

  // 2. Build lookup maps
  const phoneMap = new Map<string, HanindocBiz>();
  const nameMap = new Map<string, HanindocBiz>();
  for (const biz of hanindocBizs) {
    const phone = normalizePhone(biz.phone_formatted) || normalizePhone(biz.phone_international);
    if (phone) phoneMap.set(phone, biz);
    if (biz.name_ko) nameMap.set(biz.name_ko.trim().toLowerCase(), biz);
  }

  // 3. Load HaninMap medical businesses (medical + dental primary categories)
  const medicalCategories = await prisma.category.findMany({
    where: {
      OR: [
        { slug: 'medical' },
        { slug: 'dental' },
        { parent: { slug: { in: ['medical', 'dental'] } } },
      ],
    },
    select: { id: true },
  });
  const categoryIds = medicalCategories.map(c => c.id);

  const businesses = await prisma.business.findMany({
    where: { primaryCategoryId: { in: categoryIds } },
    select: {
      id: true,
      nameKo: true,
      phoneE164: true,
      phoneRaw: true,
      googlePlace: { select: { sourceId: true } },
    },
  });
  console.log(`  Loaded ${businesses.length} HaninMap medical businesses.`);

  // 4. Match and update
  let matched = 0;
  let bySourceId = 0;
  let byPhone = 0;
  let byName = 0;

  for (const biz of businesses) {
    let hanindoc: HanindocBiz | undefined;

    // Match by sourceId (HaninDoc UUID)
    if (biz.googlePlace?.sourceId) {
      hanindoc = hanindocBizs.find(h => h.id === biz.googlePlace!.sourceId);
      if (hanindoc) bySourceId++;
    }

    // Match by phone
    if (!hanindoc) {
      const phone = normalizePhone(biz.phoneE164) || normalizePhone(biz.phoneRaw);
      if (phone) {
        hanindoc = phoneMap.get(phone);
        if (hanindoc) byPhone++;
      }
    }

    // Match by Korean name
    if (!hanindoc && biz.nameKo) {
      hanindoc = nameMap.get(biz.nameKo.trim().toLowerCase());
      if (hanindoc) byName++;
    }

    if (hanindoc) {
      await prisma.business.update({
        where: { id: biz.id },
        data: { hanindocSlug: hanindoc.slug },
      });
      matched++;
    }
  }

  console.log(`\n=== Results ===`);
  console.log(`  Total matched: ${matched}/${businesses.length}`);
  console.log(`  By sourceId: ${bySourceId}`);
  console.log(`  By phone: ${byPhone}`);
  console.log(`  By name: ${byName}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('Sync failed:', err);
  prisma.$disconnect();
  process.exit(1);
});
