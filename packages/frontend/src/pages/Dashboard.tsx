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

function StatCard({
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
    <div className="bg-card border border-border rounded-lg p-6 hover:border-accent/30 transition-colors">
      <div className="text-[10px] tracking-[0.15em] text-text-dim mb-4 flex items-center justify-between">
        <span>{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color: accent ?? 'var(--text-dim)', opacity: 0.7 }} />}
      </div>
      {loading ? (
        <Skeleton className="h-10 w-28" />
      ) : (
        <div className="text-4xl md:text-5xl font-display font-medium tracking-tight" style={accent ? { color: accent } : {}}>
          {value}
        </div>
      )}
      {sub && (
        <div className="mt-3 text-xs font-mono text-muted-foreground">{sub}</div>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts[0]?.address

  const { data: context, isLoading: contextLoading } = useMarketContext()
  const { data: portfolios, isLoading: portfoliosLoading } = usePortfolios(address)

  if (!isConnected) {
    return (
      <div className="px-10 py-12 max-w-[1600px]">
        <ConnectPrompt title="Dashboard" description="Connect your wallet to see live bots, open cycles, and keeper status." />
      </div>
    )
  }

  const activeCount  = portfolios?.filter((p) => !p.isPaused).length ?? 0
  const totalCount   = portfolios?.length ?? 0
  const pausedCount  = portfolios?.filter((p) => p.isPaused).length ?? 0

  return (
    <div className="px-10 py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">OVERVIEW</div>
      <h1 className="text-6xl md:text-7xl font-display font-medium tracking-tight uppercase mb-12">Dashboard</h1>

      {/* Stat row */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-16">
        <StatCard
          label="ACTIVE PORTFOLIOS"
          value={portfoliosLoading ? '—' : `${activeCount}/${totalCount}`}
          sub="Strategies running"
          icon={Layers}
          loading={portfoliosLoading}
        />
        <StatCard
          label="OPEN CYCLES"
          value={contextLoading ? '—' : (context?.market?.activeOracleCount ?? '—')}
          sub="Active oracle markets"
          icon={Activity}
          loading={contextLoading}
        />
        <StatCard
          label="ATM VOLATILITY"
          value={contextLoading ? '—' : (context?.market?.latestAtmVol ? formatVol(context.market.latestAtmVol) : '—')}
          sub={context?.market?.volRegime ? `${context.market.volRegime} regime` : 'Fetching…'}
          icon={TrendingUp}
          loading={contextLoading}
        />
        <StatCard
          label="KEEPER STATUS"
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

      <div className="grid lg:grid-cols-3 gap-6 mb-16">
        {/* Live cycle radar */}
        <motion.div
          className="lg:col-span-1 bg-card border border-border rounded-lg p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          <div className="text-[10px] tracking-[0.15em] text-text-dim mb-3">LIVE CYCLE RADAR</div>
          <h2 className="text-xl font-display mb-5">What is running now</h2>
          {contextLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <p className="text-sm leading-relaxed text-muted-foreground">
              {context?.market?.activeOracleCount
                ? `${context.market.activeOracleCount} active oracle markets. ATM vol at ${context.market.latestAtmVol ? formatVol(context.market.latestAtmVol) : 'unknown'} — ${context.market.volRegime} regime.`
                : 'No active oracle markets at this moment. The keeper will pick up the next expiry automatically.'}
            </p>
          )}
          <Link
            to="/analytics"
            className="inline-flex items-center gap-1.5 text-xs mt-5 text-accent-light hover:text-accent transition-colors"
          >
            Deeper analytics <ArrowRight className="w-3 h-3" />
          </Link>
        </motion.div>

        {/* Market status */}
        <motion.div
          className="lg:col-span-2 bg-card border border-border rounded-lg p-6"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.06 }}
        >
          <div className="text-[10px] tracking-[0.15em] text-text-dim mb-3">ATTENTION QUEUE</div>
          <h2 className="text-xl font-display mb-5">Surface the problems first</h2>
          {portfoliosLoading ? (
            <Skeleton className="h-4 w-3/4" />
          ) : (
            <div className="text-sm text-muted-foreground">
              {pausedCount > 0 ? (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-warning" />
                  <span>
                    {pausedCount} portfolio{pausedCount !== 1 ? 's' : ''} paused.{' '}
                    <Link to="/portfolios" className="text-accent-light hover:text-accent">
                      View portfolios →
                    </Link>
                  </span>
                </div>
              ) : (
                'No urgent attention needed. All active portfolios are running normally.'
              )}
            </div>
          )}
          <div className="mt-6 pt-6 border-t border-border">
            <div className="text-xs text-muted-foreground mb-3">Bot engine</div>
            <div className="flex items-center gap-2 text-sm">
              <span className="w-2 h-2 rounded-full bg-success animate-pulse" />
              <span className="text-foreground">{activeCount} bots queued for next tick</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Portfolio board */}
      <div>
        <div className="flex items-end justify-between mb-6">
          <div>
            <div className="text-[10px] tracking-[0.15em] text-text-dim mb-2">YOUR POSITIONS</div>
            <h2 className="text-2xl font-display">Deployed strategies</h2>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/explore">Deploy new →</Link>
          </Button>
        </div>

        {portfoliosLoading ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-card border border-border rounded-lg p-6 space-y-4">
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
