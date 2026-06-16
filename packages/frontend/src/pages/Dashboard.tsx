import { Link } from 'react-router-dom'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { Activity, Layers, TrendingUp, Zap, ArrowRight, AlertCircle } from 'lucide-react'
import { useMarketContext } from '@/hooks/useMarketContext'
import { usePortfolios } from '@/hooks/usePortfolios'
import { StatCard } from '@/components/common/StatCard'
import { EmptyState } from '@/components/common/EmptyState'
import { PortfolioCard } from '@/components/portfolio/PortfolioCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { formatVol } from '@/lib/format'
import { ConnectPrompt } from './ConnectPrompt'

export default function Dashboard() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const address = currentWallet?.accounts[0]?.address

  const { data: context, isLoading: contextLoading } = useMarketContext()
  const { data: portfolios, isLoading: portfoliosLoading } = usePortfolios(address)

  if (!isConnected) {
    return <ConnectPrompt title="Dashboard" description="Connect your wallet to see live bots, open cycles, and keeper status." />
  }

  const activeCount = portfolios?.filter((p) => !p.isPaused).length ?? 0
  const totalTvl = portfolios?.reduce((sum, p) => sum + BigInt(p.totalDepositedRaw), 0n) ?? 0n

  return (
    <div className="space-y-6">
      <div>
        <p className="section-label mb-1">Overview</p>
        <h1 className="text-2xl font-semibold" style={{ color: 'var(--ink-primary)' }}>Dashboard</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--ink-secondary)' }}>See your active strategies, open cycles, and keeper status.</p>
      </div>

      {/* 4 stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Active Portfolios"
          value={`${activeCount}/${portfolios?.length ?? 0}`}
          subtitle="Strategies running"
          icon={Layers}
          loading={portfoliosLoading}
        />
        <StatCard
          label="Open Cycles"
          value={context?.market.activeOracleCount ?? 0}
          subtitle="Active oracle markets"
          icon={Activity}
          loading={contextLoading}
        />
        <StatCard
          label="ATM Volatility"
          value={context?.market.latestAtmVol ? formatVol(context.market.latestAtmVol) : '—'}
          subtitle={context?.market.volRegime ? `${context.market.volRegime} regime` : 'Loading...'}
          icon={TrendingUp}
          loading={contextLoading}
        />
        <StatCard
          label="Keeper Status"
          value={
            <span className="flex items-center gap-2">
              <span className="dot-live" />
              Active
            </span>
          }
          subtitle="Auto-running on testnet"
          icon={Zap}
        />
      </div>

      {/* Radar + Attention queue */}
      <div className="grid lg:grid-cols-2 gap-4">
        <div className="surface p-5">
          <p className="section-label mb-1" style={{ color: 'var(--accent)' }}>Live Cycle Radar</p>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-primary)' }}>What is actually running right now</h3>
          {contextLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
          ) : (
            <div className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
              {context?.market.activeOracleCount
                ? `${context.market.activeOracleCount} active oracle markets. ATM vol ${context.market.latestAtmVol ? formatVol(context.market.latestAtmVol) : 'unknown'} — ${context.market.volRegime} regime.`
                : 'No active oracle markets at this moment. The keeper will pick up the next expiry automatically.'}
            </div>
          )}
          <Link to="/analytics" className="inline-flex items-center gap-1.5 text-xs mt-4 transition-colors" style={{ color: 'var(--accent)' }}>
            Deeper analytics <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="surface p-5">
          <p className="section-label mb-1" style={{ color: 'var(--status-red)' }}>Attention Queue</p>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--ink-primary)' }}>Surface the problems first</h3>
          {portfoliosLoading ? (
            <Skeleton className="h-4 w-3/4" />
          ) : (
            <div className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
              {portfolios?.some((p) => p.isPaused) ? (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--status-yellow)' }} />
                  <span>
                    {portfolios.filter((p) => p.isPaused).length} portfolio(s) paused.{' '}
                    <Link to="/portfolios" style={{ color: 'var(--accent)' }} className="hover:underline">View portfolios →</Link>
                  </span>
                </div>
              ) : (
                'No urgent attention needed. All active portfolios are running normally.'
              )}
            </div>
          )}
        </div>
      </div>

      {/* Portfolio board */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="section-label mb-1">Portfolio Board</p>
            <h2 className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Every deployed strategy at a glance</h2>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link to="/explore">Deploy new</Link>
          </Button>
        </div>

        {portfoliosLoading ? (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="surface p-5 space-y-4">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
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
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {portfolios.map((p) => (
              <PortfolioCard key={p.id} portfolio={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
