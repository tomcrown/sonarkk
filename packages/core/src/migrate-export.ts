/**
 * STEP 1 of 2 — SQLite → Supabase migration
 *
 * Uses raw SQL so it reads whatever columns actually exist in dev.db,
 * regardless of any schema drift between schema.prisma and the live database.
 *
 * Run this BEFORE running prisma generate / prisma db push.
 *
 * Usage (from packages/core):
 *   DATABASE_URL="file:./prisma/dev.db" npx tsx src/migrate-export.ts
 *
 * Output: packages/core/prisma/migration-data.json
 */

import { PrismaClient } from '@prisma/client'
import { writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// BigInt-safe serialiser
const replacer = (_key: string, value: unknown) =>
  typeof value === 'bigint' ? { __bigint: value.toString() } : value

async function readTable(db: PrismaClient, table: string): Promise<unknown[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = await (db as any).$queryRawUnsafe(`SELECT * FROM "${table}"`) as unknown[]
    return rows ?? []
  } catch (e) {
    console.warn(`  [warn] ${table}: ${(e as Error).message} — skipping`)
    return []
  }
}

async function main() {
  const db = new PrismaClient()

  // Discover all user tables in the SQLite database
  const tableRows = await db.$queryRawUnsafe<{ name: string }[]>(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_prisma%' ORDER BY name`,
  )
  const tables = tableRows.map(r => r.name)
  console.log(`Found ${tables.length} tables: ${tables.join(', ')}\n`)

  const dump: Record<string, unknown[]> = {}
  const counts: Record<string, number> = {}

  for (const table of tables) {
    const rows = await readTable(db, table)
    dump[table] = rows
    counts[table] = rows.length
    console.log(`  ${table.padEnd(28)} ${rows.length} rows`)
  }

  const payload = {
    exportedAt: new Date().toISOString(),
    counts,
    tables,
    dump,
  }

  const outPath = resolve(__dirname, '../prisma/migration-data.json')
  writeFileSync(outPath, JSON.stringify(payload, replacer, 2))

  console.log(`\nExport complete → ${outPath}`)
  console.log('\nNext steps:')
  console.log('  1. Set DATABASE_URL and DIRECT_URL to your Supabase connection strings in .env')
  console.log('  2. Run: npx prisma generate && npx prisma db push')
  console.log('  3. Run: npx tsx src/migrate-import.ts\n')

  await db.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
