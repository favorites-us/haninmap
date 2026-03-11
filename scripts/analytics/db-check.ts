/**
 * Database health check script
 * Run with: npx tsx scripts/db-check.ts
 *
 * This script verifies:
 * 1. DATABASE_URL is set
 * 2. Prisma client can connect
 * 3. Basic query works
 */

import { PrismaClient } from '@prisma/client';

async function main() {
  console.log('=== Database Health Check ===\n');

  // Check env var
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL is not set');
    console.error('   Set it in .env.local for local development');
    process.exit(1);
  }
  console.log('✅ DATABASE_URL is set');

  // Mask the URL for display
  const url = process.env.DATABASE_URL;
  const maskedUrl = url.replace(/\/\/[^@]+@/, '//***:***@');
  console.log(`   URL: ${maskedUrl}\n`);

  // Check deprecated vars
  const deprecatedVars = ['PRISMA_DATABASE_URL', 'POSTGRES_URL'];
  for (const varName of deprecatedVars) {
    if (process.env[varName]) {
      console.warn(`⚠️  ${varName} is set but deprecated - remove it`);
    }
  }

  // Try to connect
  console.log('\nConnecting to database...');
  const prisma = new PrismaClient();

  try {
    // Simple query to test connection
    const result = await prisma.$queryRaw<[{ result: number }]>`SELECT 1 as result`;

    if (result[0]?.result === 1) {
      console.log('✅ Database connection successful');
    } else {
      throw new Error('Unexpected query result');
    }

    // Get some stats
    const businessCount = await prisma.business.count();
    const categoryCount = await prisma.category.count();

    console.log(`\n📊 Database Stats:`);
    console.log(`   Businesses: ${businessCount.toLocaleString()}`);
    console.log(`   Categories: ${categoryCount}`);

    console.log('\n✅ All checks passed!');

  } catch (error) {
    console.error('\n❌ Database connection failed:');
    console.error(`   ${error instanceof Error ? error.message : String(error)}`);
    console.error('\nTroubleshooting:');
    console.error('1. Check if DATABASE_URL is correct');
    console.error('2. Verify the database service is running');
    console.error('3. Check network connectivity to the database host');
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
