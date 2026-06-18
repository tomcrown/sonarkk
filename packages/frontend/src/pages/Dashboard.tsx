import { Link } from 'react-router-dom'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { AlertCircle, ArrowRight, ExternalLink } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { useMarketContext } from '@/hooks/useMarketContext'
import { usePortfolios } from '@/hooks/usePortfolios'
import { usePortfolioActivity } from '@/hooks/usePortfolioActivity'
import { usePortfolioChart } from '@/hooks/usePortfolioChart'
import { PortfolioGrid } from '@/components/portfolio/PortfolioGrid'
import { EmptyState } from '@/components/common/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Layers } from 'lucide-react'
import { ConnectPrompt } from './ConnectPrompt'
import { formatDusdc, formatPct, formatVol, timeAgo } from '@/lib/format'
import { txUrl } from '@/lib/sui'
import { cn } from '@/lib/cn'

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeTotals(portfolios: { totalDepositedRaw: string; navPerShareRaw: string }[]) {
  let totalCurrent = 0
  let totalInitial = 0
  for (const p of portfolios) {
    const deposit = Number(p.totalDepositedRaw) / 1e6
    const nav = Number(p.navPerShareRaw) / 1e9
    totalCurrent += deposit * nav
    totalInitial += deposit
  }
  const totalReturnPct = totalInitial > 0
    ? ((totalCurrent - totalInitial) / totalInitial) * 100
    : null
  return { totalCurrent, totalInitial, totalReturnPct }
}

function volRegimeLabel(regime: 'calm' | 'normal' | 'high') {
  if (regime === 'calm')   return { label: 'Calm',     color: 'text-success',  dot: 'bg-success'  }
  if (regime === 'normal') return { label: 'Active',   color: 'text-warning',  dot: 'bg-warning'  }
  return                          { label: 'Elevated', color: 'text-danger',   dot: 'bg-danger'   }
}

function volRegimeHint(regime: 'calm' | 'normal' | 'high', vol: number | null) {
  const pct = vol ? ` · ${formatVol(vol)} implied vol` : ''
  if (regime === 'calm')   return `Low volatility${pct} — favorable for house strategies`
  if (regime === 'normal') return `Normal volatility${pct} — house strategies earn well`
  return                   `Elevated volatility${pct} — avoid short-vol positions`
}

function actionLabel(action: string) {
  if (action === 'supply') return 'Supplied to pool'
  if (action === 'skip')   return 'Skipped (entry guard)'
  if (action === 'run')    return 'Cycle ran'
  return action
}

// ── Stat card ──────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, valueClass, loading,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  valueClass?: string
  loading?: boolean
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 hover:border-accent/30 transition-colors">
      <div className="text-[10px] tracking-[0.15em] text-text-dim mb-4">{label}</div>
      {loading ? (
        <Skeleton className="h-10 w-28" />
      ) : (
        <div className={cn('text-2xl md:text-3xl font-display font-medium tracking-tight', valueClass ?? 'text-foreground')}>
          {value}
        </div>
      )}
      {sub && <div className="mt-3 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ── Portfolio value chart ──────────────────────────────────────────────────────

function ValueChart({ points }: { points: Array<{ date: string; value: number }> }) {
  if (points.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-text-dim">
        Not enough data yet — chart builds as your bots run.
      </div>
    )
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={points} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="valueGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#A9A8EC" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#A9A8EC" stopOpacity={0}   />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis dataKey="date" hide />
        <YAxis
          tick={{ fontSize: 10, fill: '#58586A' }}
          axisLine={false}
          tickLine={false}
          width={52}
          tickFormatter={(v: number) => `$${v.toFixed(0)}`}
        />
        <Tooltip
          contentStyle={{
            background: '#1C1C21',
            border: '1px solid rgba(169,168,236,0.25)',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#fff',
          }}
          labelFormatter={() => ''}
          formatter={(v: number) => [`${v.toFixed(2)} DUSDC`, 'Portfolio Value']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#A9A8EC"
          strokeWidth={2}
          fill="url(#valueGradient)"
          dot={false}
          activeDot={{ r: 4, fill: '#A9A8EC', stroke: '#fff', strokeWidth: 1.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts[0]?.address

  const { data: context, isLoading: contextLoading }       = useMarketContext()
  const { data: portfolios, isLoading: portfoliosLoading } = usePortfolios(address)
  const { data: activityData, isLoading: activityLoading } = usePortfolioActivity(address, 5)
  const { data: chartData }                                = usePortfolioChart(address)

  if (!isConnected) {
    return (
      <div className="px-10 py-12 max-w-[1600px]">
        <ConnectPrompt title="Dashboard" description="Connect your wallet to see your portfolio value, bot status, and live activity." />
      </div>
    )
  }

  // ── Computed values ──────────────────────────────────────────────────────────
  const { totalCurrent, totalReturnPct } = computeTotals(portfolios ?? [])
  const returnPositive = (totalReturnPct ?? 0) >= 0

  const activeCount  = portfolios?.filter((p) => !p.isPaused).length ?? 0
  const totalCount   = portfolios?.length ?? 0
  const pausedCount  = portfolios?.filter((p) => p.isPaused).length ?? 0

  const market     = context?.market
  const regime     = market ? volRegimeLabel(market.volRegime) : null
  const regimeHint = market ? volRegimeHint(market.volRegime, market.latestAtmVol) : null

  const lastActivity = portfolios
    ?.map((p) => p.lastKeeperRun)
    .filter(Boolean)
    .sort()
    .at(-1) ?? null

  const chartPoints = chartData?.points ?? []

  return (
    <div className="px-10 py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">OVERVIEW</div>
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight uppercase mb-10">Dashboard</h1>

      {/* ── 4 stat cards ───────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-10">
        <StatCard
          label="PORTFOLIO VALUE"
          value={portfoliosLoading ? '—' : `${totalCurrent.toFixed(2)}`}
          sub={portfoliosLoading ? undefined : 'DUSDC across all strategies'}
          loading={portfoliosLoading}
        />
        <StatCard
          label="TOTAL RETURN"
          value={
            portfoliosLoading || totalReturnPct == null
              ? '—'
              : formatPct(totalReturnPct)
          }
          sub="Since first deposit"
          valueClass={
            totalReturnPct == null
              ? 'text-foreground'
              : returnPositive ? 'text-success' : 'text-danger'
          }
          loading={portfoliosLoading}
        />
        <StatCard
          label="BOTS RUNNING"
          value={portfoliosLoading ? '—' : `${activeCount} / ${totalCount}`}
          sub={pausedCount > 0 ? `${pausedCount} paused` : 'All active'}
          loading={portfoliosLoading}
        />
        <StatCard
          label="MARKET CONDITIONS"
          value={
            contextLoading || !regime ? '—' : (
              <span className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full ${regime.dot} animate-pulse`} />
                <span className={regime.color}>{regime.label}</span>
              </span>
            )
          }
          sub={regimeHint ?? undefined}
          loading={contextLoading}
        />
      </div>

      {/* ── 2 panels ───────────────────────────────────────────────────────── */}
      <div className="grid lg:grid-cols-3 gap-5 mb-10">
        {/* What's running now */}
        <motion.div
          className="bg-card border border-border rounded-lg p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="text-[10px] tracking-[0.15em] text-text-dim mb-3">WHAT'S RUNNING NOW</div>
          <h2 className="text-xl font-display mb-4">Live status</h2>
          {contextLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {market?.activeOracleCount
                ? `${market.activeOracleCount} markets open right now.`
                : 'No markets open at this moment.'}
              {lastActivity
                ? ` Last bot activity ${timeAgo(lastActivity)}.`
                : ' No bot activity yet.'}
            </p>
          )}
          <Link
            to="/analytics"
            className="inline-flex items-center gap-1.5 text-xs mt-5 text-accent-light hover:text-accent transition-colors"
          >
            Deeper analytics <ArrowRight className="w-3 h-3" />
          </Link>
        </motion.div>

        {/* Needs attention */}
        <motion.div
          className="lg:col-span-2 bg-card border border-border rounded-lg p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.06 }}
        >
          <div className="text-[10px] tracking-[0.15em] text-text-dim mb-3">NEEDS ATTENTION</div>
          <h2 className="text-xl font-display mb-4">Alerts</h2>
          {portfoliosLoading ? (
            <Skeleton className="h-4 w-3/4" />
          ) : pausedCount > 0 ? (
            <div className="flex items-start gap-2 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
              <span className="text-muted-foreground">
                {pausedCount} bot{pausedCount !== 1 ? 's' : ''} paused.{' '}
                <Link to="/portfolios" className="text-accent-light hover:text-accent">
                  View portfolios →
                </Link>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-success" />
              All bots running normally
            </div>
          )}
          <div className="mt-6 pt-6 border-t border-border flex items-center gap-2 text-sm">
            <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
            <span className="text-foreground">{activeCount} bot{activeCount !== 1 ? 's' : ''} queued for next round</span>
          </div>
        </motion.div>
      </div>

      {/* ── Total value chart ───────────────────────────────────────────────── */}
      <motion.div
        className="bg-card border border-border rounded-lg p-6 mb-10"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.1 }}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[10px] tracking-[0.15em] text-text-dim mb-1">PORTFOLIO VALUE OVER TIME</div>
            <h2 className="text-xl font-display">Total value</h2>
          </div>
          {chartPoints.length > 0 && (
            <div className="text-right">
              <div className="text-lg font-display font-medium text-foreground">
                {totalCurrent.toFixed(2)}
              </div>
              <div className="text-xs text-text-dim">DUSDC</div>
            </div>
          )}
        </div>
        <ValueChart points={chartPoints} />
      </motion.div>

      {/* ── Recent activity ────────────────────────────────────────────────── */}
      <motion.div
        className="bg-card border border-border rounded-lg p-6 mb-10"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, delay: 0.14 }}
      >
        <div className="text-[10px] tracking-[0.15em] text-text-dim mb-3">RECENT ACTIVITY</div>
        <h2 className="text-xl font-display mb-5">What your bots have been doing</h2>

        {activityLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
          </div>
        ) : !activityData || activityData.length === 0 ? (
          <p className="text-sm text-text-dim py-4">
            No activity yet — your bots will appear here once they run their first cycle.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {activityData.map((item, i) => {
              const pnlPositive = (item.cyclePnlPct ?? 0) >= 0
              return (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between py-3 gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      item.status === 'done'    ? 'bg-success' :
                      item.status === 'skipped' ? 'bg-text-dim' : 'bg-danger'
                    )} />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{item.portfolioName}</p>
                      <p className="text-xs text-text-dim">{actionLabel(item.action)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {item.cyclePnlPct != null && (
                      <span className={`text-xs font-mono font-medium ${pnlPositive ? 'text-success' : 'text-danger'}`}>
                        {pnlPositive ? '+' : ''}{item.cyclePnlPct.toFixed(3)}%
                      </span>
                    )}
                    <span className="text-xs text-text-dim w-14 text-right">{timeAgo(item.createdAt)}</span>
                    {item.txDigest && (
                      <a
                        href={txUrl(item.txDigest)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent-light hover:text-accent transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </motion.div>

      {/* ── Portfolio grid ─────────────────────────────────────────────────── */}
      <div>
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-[10px] tracking-[0.15em] text-text-dim mb-2">YOUR POSITIONS</div>
            <h2 className="text-2xl font-display">Your strategies</h2>
          </div>
          <Link
            to="/explore"
            className="inline-flex items-center gap-1.5 text-sm text-accent-light hover:text-accent transition-colors"
          >
            Deploy new <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {portfoliosLoading ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-xl p-5 space-y-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-8 w-20" />
                <div className="grid grid-cols-3 gap-3">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              </div>
            ))}
          </div>
        ) : !portfolios || portfolios.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No strategies deployed yet"
            description="Deploy your first strategy to start the bots. They'll run automatically every cycle."
            action={{ label: 'Explore strategies →', onClick: () => {} }}
          />
        ) : (
          <PortfolioGrid portfolios={portfolios} gap="4" />
        )}
      </div>
    </div>
  )
}
