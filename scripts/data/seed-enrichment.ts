/**
 * Seed enrichment queue with top businesses
 * Run with: npm run seed:enrich
 */

import { PrismaClient } from '@prisma/client';
import { seedEnrichmentQueue } from '../../src/lib/enrichment/queue';
import { getBudgetStatus } from '../../src/lib/enrichment/budget';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding enrichment queue...\n');

  try {
    // Check budget
    const budget = await getBudgetStatus();
    console.log('Current budget status:');
    console.log(`  Spent: $${budget.spentUsd.toFixed(2)} / $${budget.budgetUsd.toFixed(2)}`);
    console.log(`  Remaining: $${budget.remainingUsd.toFixed(2)}`);
    console.log(`  Estimated remaining calls: ${budget.estimatedRemainingCalls}\n`);

    // Seed queue
    const enqueued = await seedEnrichmentQueue();
    console.log(`Enqueued ${enqueued} businesses for enrichment`);

    // Show queue stats
    const pending = await prisma.enrichmentQueue.count({ where: { status: 'pending' } });
    const done = await prisma.enrichmentQueue.count({ where: { status: 'done' } });
    const failed = await prisma.enrichmentQueue.count({ where: { status: 'failed' } });

    console.log('\nQueue status:');
    console.log(`  Pending: ${pending}`);
    console.log(`  Done: ${done}`);
    console.log(`  Failed: ${failed}`);
  } catch (error) {
    console.error('Seed enrichment failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
