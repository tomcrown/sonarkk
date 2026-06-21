/**
 * STEP 2 of 2 — SQLite → Supabase migration
 *
 * Reads migration-data.json (produced by migrate-export.ts) and inserts every
 * row into PostgreSQL using INSERT ... ON CONFLICT DO NOTHING — so it is fully
 * idempotent and safe to re-run.
 *
 * Columns in the JSON that don't exist in the new PostgreSQL schema are
 * silently skipped (handles schema drift between old SQLite and new schema).
 *
 * Run this AFTER:
 *   1. DATABASE_URL and DIRECT_URL set to Supabase in .env
 *   2. npx prisma generate && npx prisma db push
 *   3. npx tsx src/migrate-export.ts already ran (migration-data.json exists)
 *
 * Usage (from packages/core):
 *   npx tsx src/migrate-import.ts
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Restore BigInt values serialised as { __bigint: "123" }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && '__bigint' in value) {
    return BigInt((value as { __bigint: string }).__bigint)
  }
  return value
}

// Build a parameterised INSERT ... ON CONFLICT DO NOTHING for one row.
// Returns [sql, params] ready for $queryRawUnsafe.
function buildInsert(
  table: string,
  row: Record<string, unknown>,
  pgColumns: Set<string>,
): [string, unknown[]] | null {
  // Only insert columns that exist in the target PostgreSQL table
  const cols = Object.keys(row).filter(c => pgColumns.has(c))
  if (cols.length === 0) return null

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ')
  const colList = cols.map(c => `"${c}"`).join(', ')
  const sql = `INSERT INTO "${table}" (${colList}) VALUES (${placeholders}) ON CONFLICT DO NOTHING`
  const params = cols.map(c => {
    const v = row[c]
    // Convert ISO date strings back to Date objects for PostgreSQL
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(v)) return new Date(v)
    return v ?? null
  })
  return [sql, params]
}

// Fetch the actual column names for every table from PostgreSQL information_schema
async function getPostgresColumns(
  db: PrismaClient,
): Promise<Map<string, Set<string>>> {
  const rows = await db.$queryRawUnsafe<{ table_name: string; column_name: string }[]>(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
  `)
  const map = new Map<string, Set<string>>()
  for (const { table_name, column_name } of rows) {
    if (!map.has(table_name)) map.set(table_name, new Set())
    map.get(table_name)!.add(column_name)
  }
  return map
}

// Import order matters for foreign key constraints
const IMPORT_ORDER = [
  'WalrusSnapshot',
  'Strategy',
  'VaultConfig',
  'BacktestResult',
  'KeeperRun',
  'LeaderboardEntry',
  'CopyRelation',
  'Portfolio',
  'OpenPosition',
  'KeeperCycle',
  'VaultLeaderboardEntry',
  'VaultCopyRelation',
  'MarginLoopState',
]

async function main() {
  const dataPath = resolve(__dirname, '../prisma/migration-data.json')
  if (!existsSync(dataPath)) {
    console.error('migration-data.json not found. Run migrate-export.ts first.')
    process.exit(1)
  }

  const raw = readFileSync(dataPath, 'utf8')
  const data = JSON.parse(raw, reviver) as {
    exportedAt: string
    tables: string[]
    dump: Record<string, Record<string, unknown>[]>
  }

  console.log(`Importing data exported at ${data.exportedAt}\n`)

  const db = new PrismaClient()
  const pgColumns = await getPostgresColumns(db)

  let totalRows = 0
  let skippedTables = 0

  // Process tables in dependency order first, then any extras from the dump
  const ordered = [
    ...IMPORT_ORDER.filter(t => data.dump[t] !== undefined),
    ...data.tables.filter(t => !IMPORT_ORDER.includes(t) && data.dump[t] !== undefined),
  ]

  for (const table of ordered) {
    const rows = data.dump[table] ?? []
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(28)} 0 rows — skipping`)
      continue
    }

    // Find matching PostgreSQL table (Prisma uses PascalCase table names)
    const pgTable = pgColumns.has(table) ? table : undefined
    if (!pgTable) {
      console.warn(`  [warn] ${table.padEnd(24)} no matching PostgreSQL table — skipping`)
      skippedTables++
      continue
    }

    const cols = pgColumns.get(pgTable)!
    let inserted = 0
    let skipped = 0

    for (const row of rows) {
      const result = buildInsert(pgTable, row, cols)
      if (!result) { skipped++; continue }
      const [sql, params] = result
      try {
        await db.$queryRawUnsafe(sql, ...params)
        inserted++
      } catch (e) {
        const msg = (e as Error).message
        // Unique constraint violations are expected on re-runs; everything else is logged
        if (!msg.includes('unique') && !msg.includes('duplicate')) {
          console.warn(`  [warn] ${table} row insert failed: ${msg}`)
        }
        skipped++
      }
    }

    console.log(`  ${table.padEnd(28)} ${inserted} inserted, ${skipped} skipped`)
    totalRows += inserted
  }

  console.log(`\nImport complete — ${totalRows} rows written to Supabase`)
  if (skippedTables > 0) console.log(`${skippedTables} tables had no matching PostgreSQL table`)
  console.log()

  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
