/**
 * Run a SQL migration file against the database via Prisma.
 * Splits multi-statement SQL and runs each statement individually.
 *
 * Usage:
 *   npx tsx scripts/run-migration.ts <migration-name>
 *
 * Example:
 *   npx tsx scripts/run-migration.ts 20260201_add_country_code
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join } from 'path';

const prisma = new PrismaClient();

/**
 * Split SQL into individual statements, respecting $$ blocks (PL/pgSQL).
 */
function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDollarBlock = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();

    // Skip pure comment lines and empty lines outside of $$ blocks
    if (!inDollarBlock && (trimmed.startsWith('--') || trimmed === '')) {
      continue;
    }

    // Track $$ blocks (DO $$ ... $$;)
    const dollarCount = (line.match(/\$\$/g) || []).length;
    if (dollarCount % 2 !== 0) {
      inDollarBlock = !inDollarBlock;
    }

    current += line + '\n';

    // Statement ends with ; at end of line, but not inside $$ block
    if (!inDollarBlock && trimmed.endsWith(';')) {
      const stmt = current.trim();
      // Skip BEGIN/COMMIT as we run each statement in its own transaction
      if (stmt && stmt !== 'BEGIN;' && stmt !== 'COMMIT;') {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Handle any remaining content
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

async function main() {
  const migrationName = process.argv[2];
  if (!migrationName) {
    console.error('Usage: npx tsx scripts/run-migration.ts <migration-name>');
    console.error('Example: npx tsx scripts/run-migration.ts 20260201_add_country_code');
    process.exit(1);
  }

  const fileName = migrationName.endsWith('.sql') ? migrationName : `${migrationName}.sql`;
  const filePath = join(__dirname, '..', 'supabase', 'migrations', fileName);

  let sql: string;
  try {
    sql = readFileSync(filePath, 'utf-8');
  } catch {
    console.error(`Migration file not found: ${filePath}`);
    process.exit(1);
  }

  const statements = splitStatements(sql);
  console.log(`Running migration: ${fileName}`);
  console.log(`Statements: ${statements.length}\n`);

  let completed = 0;
  try {
    for (const stmt of statements) {
      const preview = stmt.replace(/\s+/g, ' ').substring(0, 80);
      console.log(`  [${completed + 1}/${statements.length}] ${preview}...`);
      await prisma.$executeRawUnsafe(stmt);
      completed++;
    }
    console.log(`\nMigration completed: ${completed}/${statements.length} statements.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`\nStatement ${completed + 1} failed: ${msg}`);
    console.error(`Completed ${completed}/${statements.length} before failure.`);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
