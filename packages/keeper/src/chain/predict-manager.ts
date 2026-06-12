/**
 * PredictManager on-chain position reads.
 *
 * A PredictManager is a shared object registered per-portfolio on DeepBook Predict.
 * It holds a Table<MarketKey, BinaryPosition> of open binary positions minted via mint().
 * House strategies (supply-only) have no manager_id — they hold PLP Coins, not binary positions.
 *
 * Position read flow:
 *   1. getObject(manager_id) → extract binary_positions table object ID
 *   2. getDynamicFields(table_id) → enumerate all MarketKey → BinaryPosition entries
 *   3. Filter to the relevant oracle (by predict_id matching the current oracle cycle)
 *   4. Map each entry to HouseStrikeExposure (k, call_notional, put_notional)
 *
 * When manager_id is null (house strategies):
 *   → returns [] immediately
 *   → computeHouseNetDelta(svi, spot, []) = 0
 *   → hedge is skipped (correct — house has no binary exposure to hedge)
 *
 * deltaSource records 'positions' in both cases (null + real read) to distinguish
 * from the deprecated 55/45 LP proxy.
 */

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { HouseStrikeExposure } from '@sonarkk/core';
import { log } from '../logger.js';
import { withRetry } from '../util/retry.js';

const SVI_SCALE = 1_000_000_000;
const DUSDC_SCALE = 1_000_000; // 6 decimals

// ── On-chain types (Move JSON representation) ────────────────────────────────

interface BinaryPositionJson {
  predict_id: string;
  k_raw?: string | number;        // log-moneyness × SVI_SCALE (signed)
  k?: string | number;            // alternative field name
  call_notional_raw?: string | number;
  call_notional?: string | number;
  put_notional_raw?: string | number;
  put_notional?: string | number;
  is_call?: boolean;
  notional_raw?: string | number; // for single-leg positions
}

// ── Internal helpers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getObjectJson(client: SuiGrpcClient, objectId: string): Promise<Record<string, any> | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.core as any).getObject({
      objectId,
      include: { json: true },
    });
    const json = result?.object?.json ?? result?.json;
    if (!json || typeof json !== 'object') return null;
    return json as Record<string, unknown> as Record<string, any>;
  } catch {
    return null;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getDynamicFields(client: SuiGrpcClient, parentId: string): Promise<any[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (client.core as any).getDynamicFields({ parentId });
    return result?.data ?? result?.dynamicFields ?? [];
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Read binary positions from a PredictManager object.
 *
 * Returns HouseStrikeExposure[] for use with computeHouseNetDelta.
 * Always returns an array (never throws) — errors fall back to [].
 * deltaSource should be set to 'positions' by the caller regardless of the array length.
 */
export async function readPredictManagerPositions(
  client: SuiGrpcClient,
  managerId: string | null,
  oracleId: string,
): Promise<HouseStrikeExposure[]> {
  // House strategies have no manager → no binary positions.
  if (!managerId) {
    log.debug({ oracleId }, 'no manager_id — house strategy has no binary positions');
    return [];
  }

  try {
    return await withRetry(
      () => readPositionsFromChain(client, managerId, oracleId),
      `readPredictManagerPositions(${managerId.slice(0, 8)}...)`,
    );
  } catch (err) {
    log.warn({ managerId, oracleId, err }, 'readPredictManagerPositions failed — treating as empty');
    return [];
  }
}

async function readPositionsFromChain(
  client: SuiGrpcClient,
  managerId: string,
  oracleId: string,
): Promise<HouseStrikeExposure[]> {
  const managerJson = await getObjectJson(client, managerId);
  if (!managerJson) {
    log.warn({ managerId }, 'PredictManager object not found');
    return [];
  }

  log.debug({ managerId, fields: Object.keys(managerJson) }, 'PredictManager JSON fields');

  // Locate the binary positions table.
  // The Predict Move contract stores positions in a Table or similar structure.
  // Try several possible field names used across contract versions.
  const tableHolder =
    managerJson['binary_positions'] ??
    managerJson['positions'] ??
    managerJson['open_positions'] ??
    null;

  if (!tableHolder) {
    log.debug({ managerId }, 'no binary_positions table in manager — empty positions');
    return [];
  }

  // Table stored as { id: { id: "0x..." }, size: n } or { fields: { id: { id: ... } } }
  let tableId: string | null = null;
  if (typeof tableHolder === 'object' && tableHolder !== null) {
    const th = tableHolder as Record<string, unknown>;
    const idField = th['id'];
    if (typeof idField === 'string') {
      tableId = idField;
    } else if (typeof idField === 'object' && idField !== null) {
      const inner = (idField as Record<string, unknown>)['id'];
      if (typeof inner === 'string') tableId = inner;
    }
  }

  if (!tableId) {
    log.debug({ managerId }, 'binary_positions table has no id — treating as empty');
    return [];
  }

  const size = Number(
    (tableHolder as Record<string, unknown>)?.['size'] ?? 0,
  );
  if (size === 0) {
    return [];
  }

  // Enumerate dynamic fields (one per position key).
  const fields = await getDynamicFields(client, tableId);
  if (fields.length === 0) {
    return [];
  }

  log.info({ managerId, tableId, fieldCount: fields.length, oracleId }, 'reading PredictManager positions');

  const exposures: HouseStrikeExposure[] = [];

  for (const field of fields) {
    // Each dynamic field is a MarketKey → BinaryPosition entry.
    const fieldId = field?.objectId ?? field?.name?.value ?? null;
    if (!fieldId) continue;

    const fieldJson = await getObjectJson(client, fieldId);
    if (!fieldJson) continue;

    // The value inside the dynamic field is the BinaryPosition.
    const pos: BinaryPositionJson =
      (fieldJson['value'] as BinaryPositionJson) ??
      (fieldJson as unknown as BinaryPositionJson);

    // Filter to this oracle's predict_id.
    if (pos.predict_id && pos.predict_id !== oracleId) continue;

    // Parse k (log-moneyness) and notionals.
    const k_raw = Number(pos.k_raw ?? pos.k ?? 0);
    const k = k_raw / SVI_SCALE;

    let call_notional = 0;
    let put_notional = 0;

    if (pos.call_notional_raw !== undefined) {
      call_notional = Number(pos.call_notional_raw) / DUSDC_SCALE;
    } else if (pos.call_notional !== undefined) {
      call_notional = Number(pos.call_notional) / DUSDC_SCALE;
    }

    if (pos.put_notional_raw !== undefined) {
      put_notional = Number(pos.put_notional_raw) / DUSDC_SCALE;
    } else if (pos.put_notional !== undefined) {
      put_notional = Number(pos.put_notional) / DUSDC_SCALE;
    }

    // Single-leg binary (is_call flag).
    if (pos.notional_raw !== undefined) {
      const notional = Number(pos.notional_raw) / DUSDC_SCALE;
      if (pos.is_call) {
        call_notional = notional;
      } else {
        put_notional = notional;
      }
    }

    if (call_notional === 0 && put_notional === 0) continue;

    exposures.push({ k, call_notional, put_notional });
  }

  log.info({ managerId, oracleId, exposureCount: exposures.length }, 'PredictManager positions read');
  return exposures;
}
