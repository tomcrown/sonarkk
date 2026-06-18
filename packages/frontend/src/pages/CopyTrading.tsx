import { useState } from 'react'
import { Copy, Lock, Users, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useLeaderboard } from '@/hooks/useLeaderboard'
import { LeaderboardCaveat } from '@/components/common/LeaderboardCaveat'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPct, truncateAddress } from '@/lib/format'
import { type LeaderboardEntry } from '@/lib/api'
import { CopyTradingModal } from './CopyTradingModal'

export default function CopyTrading() {
  const { data, isLoading } = useLeaderboard(20)
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)

  const frontRunners = data?.entries.slice(0, 3) ?? []
  const allEntries   = data?.entries ?? []

  return (
    <div className="px-10 py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">MIRROR</div>
      <h1 className="text-6xl md:text-7xl font-display font-medium tracking-tight uppercase mb-12">Copy Trading</h1>

      {data?.caveat && <LeaderboardCaveat caveat={data.caveat} />}

      {/* Front runners */}
      <div className="mb-12">
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-[10px] tracking-[0.15em] text-accent mb-1">FRONT RUNNERS</div>
            <h2 className="text-2xl font-display">Top strategies this season</h2>
          </div>
          <Link to="/leaderboard" className="inline-flex items-center gap-1.5 text-xs text-accent-light hover:text-accent transition-colors">
            View top profile <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {isLoading
            ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-44 rounded-xl" />)
            : frontRunners.map((entry, i) => (
                <motion.div
                  key={entry.portfolioId}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="bg-card border border-border rounded-lg p-6 hover:border-accent/40 transition-colors group"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="font-display text-xl text-foreground uppercase truncate">{entry.portfolioName}</div>
                      <div className="text-xs text-text-dim font-mono mt-1">{truncateAddress(entry.walletAddress)}</div>
                    </div>
                    <span className="text-xs font-mono text-text-dim">#{entry.rank}</span>
                  </div>
                  <div className="flex items-start justify-between mb-1">
                    <StrategyBadge strategyType={entry.strategyType} />
                  </div>
                  <div className="mt-4 flex items-center justify-between">
                    <span className={`text-sm font-bold font-mono ${(entry.totalReturnPct ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                      {entry.totalReturnPct != null ? formatPct(entry.totalReturnPct) : '—'}
                    </span>
                    <button
                      onClick={() => setSelected(entry)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gradient-to-r from-accent-light to-accent text-background font-medium text-xs hover:opacity-90 transition-opacity"
                    >
                      <Copy className="w-3 h-3" /> Mirror
                    </button>
                  </div>
                </motion.div>
              ))}
        </div>
      </div>

      {/* Full board */}
      <div>
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.15em] text-text-dim mb-1">FULL BOARD</div>
          <h2 className="text-2xl font-display">All strategies available to copy</h2>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <div className="divide-y divide-border/50">
              {allEntries.map((entry, i) => (
                <motion.div
                  key={entry.portfolioId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-surface-2/40 transition-colors group"
                >
                  <span className="text-sm font-semibold text-text-dim w-8">#{entry.rank}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-foreground uppercase truncate">{entry.portfolioName}</p>
                      <StrategyBadge strategyType={entry.strategyType} />
                    </div>
                    <p className="text-xs text-text-dim">{truncateAddress(entry.walletAddress)}</p>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-text-dim">Return</p>
                      <p className={`text-sm font-semibold font-mono ${(entry.totalReturnPct ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                        {entry.totalReturnPct != null ? formatPct(entry.totalReturnPct) : '—'}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-text-dim">Copiers</p>
                      <p className="text-sm text-foreground flex items-center gap-1">
                        <Users className="w-3 h-3 text-text-dim" /> {entry.copierCount}
                      </p>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-2">
                      <Button size="sm" variant="ghost" asChild>
                        <Link to={`/portfolios/${entry.portfolioId}`}>View</Link>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setSelected(entry)}>
                        <Lock className="w-3 h-3" /> Copy
                      </Button>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      <CopyTradingModal entry={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  )
}
