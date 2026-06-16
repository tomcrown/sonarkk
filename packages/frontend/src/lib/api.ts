import { API_BASE } from './constants'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LeaderboardEntry {
  rank: number
  portfolioId: string
  portfolioName: string
  strategyType: number
  walletAddress: string
  tvlRaw: string
  totalReturnPct: number
  rollingApyPct: number
  cycleCount: number
  copierCount: number
  walrusBlobId: string | null
  sealBlobId: string | null
}

export interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  caveat: string
  total: number
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
  createdAt: string
}

export interface MarketContext {
  activeOracleCount: number
  latestAtmVol: number | null
  btcPriceUsd: number | null
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
}

export interface BacktestResult {
  metrics: BacktestMetrics
  equityCurve: Array<{ date: string; value: number }>
  pnlCurve: Array<{ date: string; value: number }>
  regimeBreakdown: Record<string, RegimeRow>
  riskDisclosure: string | null
  caveat: string
}

export interface SviStrike {
  k: number
  prob: number
  spread: number
  w: number
}

export interface SviExpiry {
  expiryMs: string
  atmVol: number
  strikes: SviStrike[]
}

export interface SviSurfaceResponse {
  surface: SviExpiry[]
  timestamp: string
}

export interface PatchPortfolioBody {
  name?: string
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

export interface ChainConfig {
  keeperAddress: string | null
  sonarkPackage: string
  predictPackage: string
  predictObject: string
  dusdcType: string
  clockId: string
  network: string
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
    list: (params?: { limit?: number; offset?: number }) => {
      const q = new URLSearchParams()
      if (params?.limit) q.set('limit', String(params.limit))
      if (params?.offset) q.set('offset', String(params.offset))
      return apiFetch<LeaderboardResponse>(`/leaderboard?${q}`)
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
  },

  chainConfig: () => apiFetch<ChainConfig>('/chain-config'),

  context: {
    get: (portfolioId?: string) => {
      const q = portfolioId ? `?portfolioId=${encodeURIComponent(portfolioId)}` : ''
      return apiFetch<ContextResponse>(`/context${q}`)
    },
  },

  backtest: {
    run: (body: {
      strategyType: number
      timeframe?: string
      startDate?: string
      endDate?: string
      initialCapital?: number
      utilTarget?: number
      volTargetBps?: number
    }) =>
      apiFetch<BacktestResult>('/backtest', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
  },

  sviSurface: {
    get: () => apiFetch<SviSurfaceResponse>('/svi-surface'),
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
): AsyncGenerator<string> {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, portfolioId, history }),
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
            const parsed = JSON.parse(data) as { token?: string }
            if (parsed.token) yield parsed.token
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
