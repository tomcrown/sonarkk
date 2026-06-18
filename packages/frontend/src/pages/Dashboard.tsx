import { Link } from 'react-router-dom'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { Activity, Layers, TrendingUp, Zap, ArrowRight, AlertCircle } from 'lucide-react'
import { motion } from 'framer-motion'
import { useMarketContext } from '@/hooks/useMarketContext'
import { usePortfolios } from '@/hooks/usePortfolios'
import { EmptyState } from '@/components/common/EmptyState'
import { PortfolioGrid } from '@/components/portfolio/PortfolioGrid'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { formatVol } from '@/lib/format'
import { ConnectPrompt } from './ConnectPrompt'

function HeroStatCard({
  label,
  value,
  sub,
  accent,
  loading,
  icon: Icon,
}: {
  label: string
  value: React.ReactNode
  sub?: string
  accent?: string
  loading?: boolean
  icon?: React.ElementType
}) {
  return (
    <div className="surface p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="section-label" style={{ color: accent ?? 'var(--ink-muted)' }}>{label}</p>
        {Icon && <Icon className="w-4 h-4" style={{ color: accent ?? 'var(--ink-muted)', opacity: 0.6 }} />}
      </div>
      {loading ? (
        <Skeleton className="h-12 w-28" />
      ) : (
        <p className="hero-num">{value}</p>
      )}
      {sub && <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{sub}</p>}
    </div>
  )
}

export default function Dashboard() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts[0]?.address

  const { data: context, isLoading: contextLoading } = useMarketContext()
  const { data: portfolios, isLoading: portfoliosLoading } = usePortfolios(address)

  if (!isConnected) {
    return <ConnectPrompt title="Dashboard" description="Connect your wallet to see live bots, open cycles, and keeper status." />
  }

  const activeCount = portfolios?.filter((p) => !p.isPaused).length ?? 0
  const totalCount  = portfolios?.length ?? 0
  const pausedCount = portfolios?.filter((p) => p.isPaused).length ?? 0

  return (
    <div className="space-y-10">

      {/* ── Page header ──────────────────────────────────────────────── */}
      <div>
        <p className="section-label mb-3">Overview</p>
        <h1 className="page-title">Dashboard</h1>
        <p className="text-sm mt-3" style={{ color: 'var(--ink-secondary)' }}>
          See live strategies, open cycles, and keeper status.
        </p>
      </div>

      {/* ── Hero stat row ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <HeroStatCard
          label="Active Portfolios"
          value={`${activeCount}/${totalCount}`}
          sub="Strategies running"
          icon={Layers}
          loading={portfoliosLoading}
        />
        <HeroStatCard
          label="Open Cycles"
          value={context?.market?.activeOracleCount ?? '—'}
          sub="Active oracle markets"
          icon={Activity}
          loading={contextLoading}
        />
        <HeroStatCard
          label="ATM Volatility"
          value={context?.market?.latestAtmVol ? formatVol(context.market.latestAtmVol) : '—'}
          sub={context?.market?.volRegime ? `${context.market.volRegime} regime` : 'Fetching…'}
          icon={TrendingUp}
          loading={contextLoading}
        />
        <HeroStatCard
          label="Keeper Status"
          value={
            <span className="flex items-center gap-3">
              <span className="dot-live" />
              Active
            </span>
          }
          sub="Auto-running on testnet"
          accent="var(--status-green)"
          icon={Zap}
        />
      </div>

      {/* ── Two-column radar / attention ──────────────────────────────── */}
      <div className="grid lg:grid-cols-2 gap-4">
        <motion.div
          className="surface p-7"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <p className="section-label mb-2" style={{ color: 'var(--accent)' }}>Live Cycle Radar</p>
          <h3 className="card-heading mb-5">What is actually running right now</h3>
          {contextLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {context?.market?.activeOracleCount
                ? `${context.market.activeOracleCount} active oracle markets. ATM vol at ${context.market.latestAtmVol ? formatVol(context.market.latestAtmVol) : 'unknown'} — ${context.market.volRegime} regime.`
                : 'No active oracle markets at this moment. The keeper will pick up the next expiry automatically.'}
            </p>
          )}
          <Link
            to="/analytics"
            className="inline-flex items-center gap-1.5 text-xs mt-5 transition-colors"
            style={{ color: 'var(--accent)' }}
          >
            Deeper analytics <ArrowRight className="w-3 h-3" />
          </Link>
        </motion.div>

        <motion.div
          className="surface p-7"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.06 }}
        >
          <p className="section-label mb-2" style={{ color: pausedCount > 0 ? 'var(--status-red)' : 'var(--ink-muted)' }}>
            Attention Queue
          </p>
          <h3 className="card-heading mb-5">Surface the problems first</h3>
          {portfoliosLoading ? (
            <Skeleton className="h-4 w-3/4" />
          ) : (
            <div className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
              {pausedCount > 0 ? (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--status-yellow)' }} />
                  <span>
                    {pausedCount} portfolio{pausedCount !== 1 ? 's' : ''} paused.{' '}
                    <Link to="/portfolios" style={{ color: 'var(--accent)' }} className="hover:underline">
                      View portfolios →
                    </Link>
                  </span>
                </div>
              ) : (
                'No urgent attention needed. All active portfolios are running normally.'
              )}
            </div>
          )}
        </motion.div>
      </div>

      {/* ── Portfolio board ───────────────────────────────────────────── */}
      <div>
        <div className="flex items-end justify-between mb-6">
          <div>
            <p className="section-label mb-2">Portfolio Board</p>
            <h2 className="card-heading">Every deployed strategy at a glance</h2>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/explore">Deploy new →</Link>
          </Button>
        </div>

        {portfoliosLoading ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="surface p-6 space-y-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-10 w-20" />
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
            title="No portfolios deployed yet"
            description="Deploy your first strategy to start the keeper. Draft strategies appear here before going live."
            action={{ label: 'Explore strategies →', onClick: () => {} }}
          />
        ) : (
          <PortfolioGrid portfolios={portfolios} gap="4" />
        )}
      </div>
    </div>
  )
}
