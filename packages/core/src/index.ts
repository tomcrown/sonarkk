export { env } from './env.js';
export { suiClient, graphqlClient } from './sui-client.js';
export { predictClient } from './predict-client.js';
export type { Oracle, OraclePrice, OracleSvi } from './predict-client.js';

// Math modules — re-exported so keeper imports from '@sonarkk/core'
export { fetchPredictVaultState, computeNav, formatNavComponents } from './math/nav.js';
export type { NavInputs, NavComponents, OpenBettorPosition } from './math/nav.js';

export { shouldSkipExpiry, computeSpread, MIN_ATM_VOL } from './math/entry-guard.js';
export type { StrategyId, EntryGuardResult } from './math/entry-guard.js';

export {
  computeHouseNetDelta, computeNetDelta, computeHouseNetDeltaSynthetic,
  binaryCallProb, binaryCallDeltaNorm, atmVol, sviW, Phi, phi,
  MIN_T_YEARS_FOR_HEDGE,
} from './math/delta.js';
export type { SviParams, BinaryPosition, RangePosition, HouseStrikeExposure } from './math/delta.js';

export { computeHedgeOrder, hedgePnl, DEFAULT_FRICTION_BPS, MIN_HEDGE_NOTIONAL_DUSDC } from './math/hedge.js';
export type { HedgeInput, HedgeOrder } from './math/hedge.js';

export {
  sizePlpSupplier, sizeHedgedPlp, sizeSmartVault, sizePrincipalProtected,
  sizeRangeRoll, sizeVolTargetedRange, sizeVolArb,
  DEFAULT_HOUSE_UTIL, BETTOR_TARGET_VOL,
} from './math/sizing.js';
export type { SizingResult } from './math/sizing.js';

// DB client
export { getPrismaClient, disconnectPrisma } from './db/client.js';
