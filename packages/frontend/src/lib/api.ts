import { API_BASE } from './constants'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number
  portfolioId: string
  portfolioName: string
  strategyType: number
  walletAddress: string
  tvlRaw: string
  totalReturnPct: number | null
  rollingApyPct: number | null
  cycleCount: number
  copierCount: number
  walrusBlobId: string | null
  sealBlobId: string | null
}

export interface WalrusSnapshotRef {
  date: string
  blobId: string
  suiEventDigest: string | null
}

export interface WalrusSnapshot {
  id: string
  date: string
  blobId: string | null
  suiEventDigest: string | null
  writtenAt: string
  writeError: string | null
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  caveat: string
  total: number
  latestWalrusSnapshot: WalrusSnapshotRef | null
}

// Internal raw shape returned by the /leaderboard endpoint
interface RawLeaderboardEntry {
  rank: number
  vault_config_id: string
  name: string
  creator: string
  is_public: boolean
  seal_blob_id: string | null
  allocations: Array<{ strategy: string; allocationBps: number }>
  combined_tvl_dusdc: string | null
  total_return_pct: number | null
  rolling_apy_pct: number | null
  apy_caveat: string | null
  total_cycles: number
  successful_cycles: number
  copier_count: number
}

interface RawLeaderboardResponse {
  entries: RawLeaderboardEntry[]
  count: number
  caveat: string
  latestWalrusSnapshot: WalrusSnapshotRef | null
}

// Internal raw shape returned by /backtest
interface BacktestRegimeData {
  oracle_count: number
  net_apy_pct: number
  max_drawdown_pct: number
  sharpe: number | null
  win_rate_pct: number | null
}

interface RawRoundPoint {
  ms: number
  nav: number
  pnl_fraction: number
}

interface RawSensitivityPoint {
  util_pct: number
  net_apy_pct: number
  max_drawdown_pct: number
  sharpe: number
  win_rate_pct: number | null
}

interface RawVolStressRow {
  strategy: string
  sigma_pct: number
  vol_label: string
  net_apy_pct: number
  win_rate_pct: number
  mode?: string
}

interface RawBacktestStrategy {
  strategy_id: string
  strategy_name: string
  class: string
  net_apy_pct: number
  max_drawdown_pct: number
  sharpe: number | null
  win_rate_pct: number | null
  spread_cost_pct: number | null
  round_results: RawRoundPoint[]
  sensitivity: RawSensitivityPoint[]
  break_even_vol_pct: number | null
  regime: {
    calm_lt_25: BacktestRegimeData | null
    normal_25_50: BacktestRegimeData | null
    high_gt_50: BacktestRegimeData | null
  }
  apy_caveat: string
  risk_disclosure: string | null
}

interface RawBacktestResponse {
  strategies: RawBacktestStrategy[]
  oracle_count: number
  period_start: string
  period_end: string
  realized_btc_vol_pct: number | null
  config_used: Record<string, unknown>
  vol_stress_test: RawVolStressRow[]
  global_caveat: string
}

// Strategy string ↔ number mappings
const STRATEGY_STR_TO_NUM: Record<string, number> = {
  PLP_SUPPLIER: 0,
  HEDGED_PLP: 1,
  SMART_VAULT: 2,
  PRINCIPAL_PROTECTED: 3,
  RANGE_ROLL: 4,
  VOL_TARGETED_RANGE: 5,
  CROSS_VENUE_ARB: 6,
  MARGIN_LOOP: 7,
}

const STRATEGY_NUM_TO_ID: Record<number, string> = {
  0: 'plp_supplier',
  1: 'hedged_plp',
  2: 'smart_vault',
  3: 'principal_protected',
  4: 'range_roll',
  5: 'vol_targeted_range',
  6: 'vol_arb',
}

// Translate raw leaderboard response to the typed LeaderboardEntry shape
function translateLeaderboardResponse(raw: RawLeaderboardResponse): LeaderboardResponse {
  return {
    entries: raw.entries.map((e) => {
      const firstStrategy = e.allocations[0]?.strategy
      const strategyType = firstStrategy != null ? (STRATEGY_STR_TO_NUM[firstStrategy] ?? 0) : 0
      const tvlRaw = e.combined_tvl_dusdc
        ? String(Math.round(parseFloat(e.combined_tvl_dusdc) * 1e6))
        : '0'
      return {
        rank: e.rank,
        portfolioId: e.vault_config_id,
        portfolioName: e.name,
        strategyType,
        walletAddress: e.creator,
        tvlRaw,
        totalReturnPct: e.total_return_pct ?? null,
        rollingApyPct: e.rolling_apy_pct ?? null,
        cycleCount: e.total_cycles,
        copierCount: e.copier_count,
        walrusBlobId: null,
        sealBlobId: e.seal_blob_id ?? null,
      }
    }),
    caveat: raw.caveat,
    total: raw.count,
    latestWalrusSnapshot: raw.latestWalrusSnapshot ?? null,
  }
}

// Translate raw backtest response to the typed BacktestResult shape
function translateBacktestResponse(raw: RawBacktestResponse, strategyType: number): BacktestResult {
  const stratId = STRATEGY_NUM_TO_ID[strategyType] ?? 'plp_supplier'
  const s = raw.strategies.find((x) => x.strategy_id === stratId) ?? raw.strategies[0]
  if (!s) throw new Error('No strategy data returned from backtest')

  const durationYears =
    (new Date(raw.period_end).getTime() - new Date(raw.period_start).getTime()) /
    (365.25 * 24 * 3600 * 1000)
  const totalReturnPct = (Math.pow(1 + s.net_apy_pct / 100, durationYears) - 1) * 100

  // Real per-round NAV series from backend
  const roundResults: RoundPoint[] = s.round_results.map((r) => ({
    date: new Date(r.ms).toISOString().split('T')[0]!,
    nav: r.nav,
    pnlFraction: r.pnl_fraction,
  }))

  // equityCurve / pnlCurve in legacy shape for ResultChart (still used)
  const equityCurve = roundResults.length > 0
    ? [{ date: new Date(raw.period_start).toISOString().split('T')[0]!, value: 100 },
       ...roundResults.map((r) => ({ date: r.date, value: r.nav }))]
    : [{ date: new Date(raw.period_start).toISOString().split('T')[0]!, value: 100 },
       { date: new Date(raw.period_end).toISOString().split('T')[0]!, value: 100 * (1 + totalReturnPct / 100) }]

  const pnlCurve = equityCurve.map((p, i) => ({
    date: p.date,
    value: i === 0 ? 0 : parseFloat((p.value - (equityCurve[i - 1]?.value ?? 100)).toFixed(4)),
  }))

  const regimeBreakdown: Record<string, RegimeRow> = {}
  const regimes: [string, BacktestRegimeData | null][] = [
    ['calm', s.regime.calm_lt_25],
    ['normal', s.regime.normal_25_50],
    ['high', s.regime.high_gt_50],
  ]
  for (const [key, r] of regimes) {
    if (r) {
      regimeBreakdown[key] = {
        apyPct:        r.net_apy_pct,
        cycleCount:    r.oracle_count,
        winRate:       r.win_rate_pct != null ? r.win_rate_pct / 100 : undefined,
        sharpe:        r.sharpe ?? undefined,
        maxDrawdownPct: r.max_drawdown_pct,
      }
    }
  }

  const sensitivity: SensitivityPoint[] = (s.sensitivity ?? []).map((p) => ({
    utilPct:       p.util_pct,
    netApyPct:     p.net_apy_pct,
    maxDrawdownPct: p.max_drawdown_pct,
    sharpe:        p.sharpe,
    winRatePct:    p.win_rate_pct,
  }))

  const volStressTest: VolStressRow[] = (raw.vol_stress_test ?? []).map((r) => ({
    strategy:   r.strategy,
    sigmaPct:   r.sigma_pct,
    volLabel:   r.vol_label,
    netApyPct:  r.net_apy_pct,
    winRatePct: r.win_rate_pct,
    mode:       r.mode,
  }))

  return {
    metrics: {
      strategyType,
      apyPct:        s.net_apy_pct,
      rollingApyPct: s.net_apy_pct,
      sharpe:        s.sharpe,
      maxDrawdownPct: s.max_drawdown_pct,
      winRate:       (s.win_rate_pct ?? 0) / 100,
      spreadCostPct: s.spread_cost_pct ?? 0,
      spreadEatenPct: s.spread_cost_pct ?? 0,
      totalReturnPct,
      cycleCount:    raw.oracle_count,
    },
    equityCurve,
    pnlCurve,
    roundResults,
    regimeBreakdown,
    sensitivity,
    volStressTest,
    breakEvenVolPct: s.break_even_vol_pct,
    periodStart:     raw.period_start,
    periodEnd:       raw.period_end,
    oracleCount:     raw.oracle_count,
    realizedBtcVolPct: raw.realized_btc_vol_pct,
    strategyClass:   s.class as 'house' | 'bettor',
    riskDisclosure:  s.risk_disclosure,
    caveat:          s.apy_caveat ?? raw.global_caveat,
  }
}

export interface OpenPosition {
  id: string
  marketId: string
  marketType: string
  positionType: string
  strikeOrRange: string
  sizeRaw: string
  notional: string
  expiryMs: string
  maxPayout: string
  currentValueRaw: string | null
  openedAt: string
}

export interface KeeperCycle {
  id: string
  expiryMs: string
  action: string
  pnlRaw: string | null
  atmVol: number | null
  txDigest: string | null
  hedgeTxDigest: string | null
  hedgeDirection: string | null
  coverageRatioPct: number | null
  status: string
  errorMessage: string | null
  createdAt: string
}

export interface NavPoint {
  ts: string
  navPerShare: string
}

export interface Portfolio {
  id: string
  name: string
  walletAddress: string
  strategyType: number
  vaultObjectId: string | null
  navPerShareRaw: string
  totalDepositedRaw: string
  totalDeposited: string
  isPaused: boolean
  pauseReason: string | null
  utilTarget: number
  volTargetBps: number | null
  minAtmVolOverride: number | null
  strikeSelection: string
  liquidityReservePct: number
  drawdownPauseThresholdPct: number
  policyCapId: string
  sealBlobId: string | null
  copyFeeRaw: string | null
  createdAt: string
  lastKeeperRun: string | null
  totalReturnPct: number | null
  rollingApyPct: number | null
  maxDrawdownPct: number | null
  navHistory: NavPoint[]
  openPositions: OpenPosition[]
  cycles: KeeperCycle[]
  recentCycles: KeeperCycle[]
}

export interface PortfolioListItem {
  id: string
  name: string
  strategyType: number
  navPerShareRaw: string
  totalDepositedRaw: string
  isPaused: boolean
  cycleCount: number
  vaultConfigId: string | null
  createdAt: string
  lastKeeperRun: string | null
  totalReturnPct: number | null
}

export interface ActivityItem {
  id: string
  portfolioId: string
  portfolioName: string
  strategyType: number
  action: string
  cyclePnlPct: number | null
  atmVol: number | null
  txDigest: string | null
  status: string
  createdAt: string
}

export interface ChartPoint { date: string; value: number }
export interface ChartResponse { points: ChartPoint[] }

export interface MarketContext {
  activeOracleCount: number
  latestAtmVol: number | null
  btcPriceUsd: number | null
  spreadAtAtm: number | null
  expiryInMinutes: number | null
  volRegime: 'calm' | 'normal' | 'high'
  timestamp: string
}

export interface ContextResponse {
  market: MarketContext
  portfolio: Portfolio | null
  leaderboardPreview: LeaderboardEntry[]
}

export interface BacktestMetrics {
  strategyType: number
  apyPct: number
  rollingApyPct: number
  sharpe: number | null
  maxDrawdownPct: number
  winRate: number
  spreadCostPct: number
  spreadEatenPct: number
  totalReturnPct: number
  cycleCount: number
}

export interface RegimeRow {
  apyPct: number
  returnPct?: number
  cycleCount: number
  winRate?: number
  sharpe?: number
  maxDrawdownPct?: number
}

export interface RoundPoint {
  date: string    // ISO date string (YYYY-MM-DD)
  nav: number     // NAV starting at 100
  pnlFraction: number
}

export interface SensitivityPoint {
  utilPct: number
  netApyPct: number
  maxDrawdownPct: number
  sharpe: number
  winRatePct: number | null
}

export interface VolStressRow {
  strategy: string
  sigmaPct: number
  volLabel: string
  netApyPct: number
  winRatePct: number
  mode?: string
}

export interface BacktestResult {
  metrics: BacktestMetrics
  equityCurve: Array<{ date: string; value: number }>
  pnlCurve: Array<{ date: string; value: number }>
  roundResults: RoundPoint[]
  regimeBreakdown: Record<string, RegimeRow>
  sensitivity: SensitivityPoint[]
  volStressTest: VolStressRow[]
  breakEvenVolPct: number | null
  periodStart: string
  periodEnd: string
  oracleCount: number
  realizedBtcVolPct: number | null
  strategyClass: 'house' | 'bettor'
  riskDisclosure: string | null
  caveat: string
}

export interface SviStrike {
  k: number
  vol: number   // implied vol at this strike (fraction, e.g. 0.40)
  prob: number
  spread: number
  w: number
}

export interface SviExpiry {
  expiryMs: string
  tYears: number
  atmVol: number
  strikes: SviStrike[]
}

export interface SviSurfaceResponse {
  surface: SviExpiry[]
  timestamp: string
}

export interface PatchPortfolioBody {
  name?: string
  is_paused?: boolean
  pause_reason?: string
  utilTarget?: number
  volTargetBps?: number | null
  minAtmVolOverride?: number | null
  strikeSelection?: string
  liquidityReservePct?: number
  drawdownPauseThresholdPct?: number
}

export interface CreatePortfolioBody {
  object_id: string
  policy_cap_id: string
  owner_address: string
  strategy_type: number
  name?: string
  initial_deposit_raw?: string
  util_target?: number
  strike_selection?: string
  liquidity_reserve_pct?: number
  drawdown_pause_threshold_pct?: number | null
  vol_target_bps?: number | null
  hedge_multiplier?: number
}

export interface KeeperSetupBody {
  portfolio_id: string
  policy_cap_id: string
  strategy_type: number
  deposit_raw: string
}

export type RunCycleEvent =
  | { type: 'progress'; message: string }
  | { type: 'tx'; protocol: string; label: string; digest: string; url: string }
  | { type: 'done'; cycleId: string; supplyTxDigest: string | null; hedgeTxDigest: string | null; hedgeDirection: string | null; coverageRatioPct: number | null }
  | { type: 'error'; message: string }

export interface ChainConfig {
  keeperAddress: string | null
  sonarkPackage: string
  predictPackage: string
  predictObject: string
  dusdcType: string
  clockId: string
  network: string
  sealKeyServerIds: string[]
  walrusPublisherUrl: string
  walrusAggregatorUrl: string
}

export interface VaultConfigAllocation {
  strategy: string
  strategyType: number
  allocationBps: number
  utilTarget: number
  strikeSelection: string
  liquidityReservePct: number
  drawdownPauseThresholdPct: number | null
  volTargetBps: number | null
  hedgeMultiplier: number
}

export interface VaultConfigDetail {
  id: string
  name: string
  creatorAddress: string
  isPublic: boolean
  copyFeeRaw: string | null
  sealBlobId: string | null
  portfolioObjectIds: string[]
  allocations: VaultConfigAllocation[]
}

// ── Fetch helper ───────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const text = await res.text().catch(() => 'Unknown error')
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

// ── API functions ──────────────────────────────────────────────────────────────

export const api = {
  leaderboard: {
    list: async (params?: { limit?: number; offset?: number }): Promise<LeaderboardResponse> => {
      const q = new URLSearchParams()
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))
      const raw = await apiFetch<RawLeaderboardResponse>(`/leaderboard?${q}`)
      return translateLeaderboardResponse(raw)
    },
  },

  portfolios: {
    list: (walletAddress: string) =>
      apiFetch<PortfolioListItem[]>(`/portfolios?wallet=${encodeURIComponent(walletAddress)}`),

    get: (id: string) => apiFetch<Portfolio>(`/portfolios/${id}`),

    patch: (id: string, body: PatchPortfolioBody) =>
      apiFetch<{ updated: boolean; id: string; object_id: string }>(`/portfolios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    create: (body: CreatePortfolioBody) =>
      apiFetch<{ id: string; object_id: string; already_existed?: boolean }>('/portfolios', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    keeperSetup: (body: KeeperSetupBody) =>
      apiFetch<{ manager_id: string | null; setup_tx_digest: string; error?: string }>('/portfolios/keeper-setup', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    streamRunCycle: async function* (portfolioId: string): AsyncGenerator<RunCycleEvent> {
      const res = await fetch(`${API_BASE}/portfolios/${portfolioId}/run-cycle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (!res.ok) throw new Error(`run-cycle API ${res.status}`)
      if (!res.body) throw new Error('No response body')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const raw = line.slice(6).trim()
              if (!raw) continue
              try {
                yield JSON.parse(raw) as RunCycleEvent
              } catch {
                // ignore malformed
              }
            }
          }
        }
      } finally {
        reader.releaseLock()
      }
    },

    activity: (walletAddress: string, limit = 10) =>
      apiFetch<ActivityItem[]>(
        `/portfolios/activity?wallet=${encodeURIComponent(walletAddress)}&limit=${limit}`
      ),

    chart: (walletAddress: string) =>
      apiFetch<ChartResponse>(
        `/portfolios/chart?wallet=${encodeURIComponent(walletAddress)}`
      ),
  },

  chainConfig: () => apiFetch<ChainConfig>('/chain-config'),

  context: {
    get: (portfolioId?: string, walletAddress?: string) => {
      const q = new URLSearchParams()
      if (portfolioId) q.set('portfolio_id', portfolioId)
      if (walletAddress) q.set('wallet_address', walletAddress)
      const qs = q.toString()
      return apiFetch<ContextResponse>(`/context${qs ? `?${qs}` : ''}`)
    },
  },

  backtest: {
    run: async (body: {
      strategyType: number
      timeframe?: string
      startDate?: string
      endDate?: string
      initialCapital?: number
      utilTarget?: number
      volTargetBps?: number
    }): Promise<BacktestResult> => {
      const stratId = STRATEGY_NUM_TO_ID[body.strategyType] ?? 'plp_supplier'
      const raw = await apiFetch<RawBacktestResponse>('/backtest', {
        method: 'POST',
        body: JSON.stringify({
          strategies: [stratId],
          utilization: body.utilTarget,
        }),
      })
      return translateBacktestResponse(raw, body.strategyType)
    },
  },

  sviSurface: {
    get: () => apiFetch<SviSurfaceResponse>('/svi-surface'),
  },

  telegram: {
    getLinkCode: (walletAddress: string) =>
      apiFetch<{ code: string; expires_at: string }>('/telegram/link-code', {
        method: 'POST',
        body: JSON.stringify({ wallet_address: walletAddress }),
      }),

    getStatus: (walletAddress: string) =>
      apiFetch<{
        linked: boolean
        username?: string
        preferences?: {
          notifySupply: boolean
          notifyError: boolean
          notifyNavMilestone: boolean
          notifyPolicyCap: boolean
        }
      }>(`/telegram/status?wallet=${encodeURIComponent(walletAddress)}`),

    unlink: (walletAddress: string) =>
      apiFetch<{ unlinked: boolean }>('/telegram/unlink', {
        method: 'DELETE',
        body: JSON.stringify({ wallet_address: walletAddress }),
      }),

    updatePreferences: (walletAddress: string, prefs: {
      notifySupply?: boolean
      notifyError?: boolean
      notifyNavMilestone?: boolean
      notifyPolicyCap?: boolean
    }) =>
      apiFetch<{ updated: boolean; preferences: Record<string, boolean> }>('/telegram/preferences', {
        method: 'PATCH',
        body: JSON.stringify({ wallet_address: walletAddress, ...prefs }),
      }),
  },

  vaultConfigs: {
    create: (body: {
      name: string
      creator_address: string
      portfolio_ids: string[]
      allocations: Array<{ strategy: string; allocationBps: number }>
      is_public?: boolean
      copy_fee_raw?: string
    }) =>
      apiFetch<{ vault_config_id: string; name: string }>('/vault-configs', {
        method: 'POST',
        body: JSON.stringify(body),
      }),

    get: (id: string) => apiFetch<VaultConfigDetail>(`/vault-configs/${id}`),

    patch: (id: string, body: { seal_blob_id?: string; copy_fee_raw?: string; is_public?: boolean }) =>
      apiFetch<{ updated: boolean; id: string }>(`/vault-configs/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),

    copy: (id: string, body: { follower_address: string; portfolio_ids: string[] }) =>
      apiFetch<{ vault_config_id: string; name: string }>(`/vault-configs/${id}/copy`, {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },
}

// ── SSE streaming for /chat ───────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function* streamChat(
  message: string,
  portfolioId?: string,
  history?: ChatMessage[],
  signal?: AbortSignal,
  walletAddress?: string,
): AsyncGenerator<string> {
  const messages = [
    ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: message },
  ]

  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages,
      wallet_address: walletAddress,
      portfolio_id: portfolioId,
    }),
    signal,
  })

  if (!res.ok) throw new Error(`Chat API ${res.status}`)
  if (!res.body) throw new Error('No response body')

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim()
          if (data === '[DONE]') return
          try {
            const parsed = JSON.parse(data) as { text?: string; done?: boolean; error?: string }
            if (parsed.done) return
            if (parsed.text) yield parsed.text
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── Walrus snapshots ──────────────────────────────────────────────────────────

export async function fetchWalrusSnapshots(): Promise<WalrusSnapshot[]> {
  const res = await fetch(`${API_BASE}/walrus/snapshots`)
  if (!res.ok) throw new Error(`Failed to fetch Walrus snapshots: ${res.status}`)
  const json = await res.json() as { snapshots: WalrusSnapshot[] }
  return json.snapshots
}

export async function triggerWalrusSnapshot(): Promise<WalrusSnapshotRef> {
  const res = await fetch(`${API_BASE}/walrus/snapshot`, { method: 'POST' })
  const json = await res.json() as WalrusSnapshotRef & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json
}
