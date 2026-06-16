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
  const allEntries = data?.entries ?? []

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">Discover</p>
        <h1 className="text-2xl font-semibold text-white">Copy Trading</h1>
        <p className="text-sm text-[#9191A4] mt-1">
          Browse verified strategies. Pay once to access the creator's config and deploy an identical portfolio.
        </p>
      </div>

      {data?.caveat && <LeaderboardCaveat caveat={data.caveat} />}

      {/* Front Runners */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#A9A8EC] mb-1">Front Runners</p>
            <h2 className="text-sm font-semibold text-white">Top strategies this season</h2>
          </div>
          <Link to="/leaderboard" className="text-xs text-[#A9A8EC] hover:text-[#D4CDF9] flex items-center gap-1 transition-colors">
            View top profile <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        <div className="grid md:grid-cols-3 gap-4">
          {isLoading
            ? [1, 2, 3].map((i) => <Skeleton key={i} className="h-36 rounded-xl" />)
            : frontRunners.map((entry, i) => (
                <motion.div
                  key={entry.portfolioId}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="bg-[#1C1C21] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 hover:border-[rgba(169,168,236,0.25)] transition-all"
                >
                  <div className="flex items-start justify-between mb-3">
                    <span className="text-xs font-bold text-[#A9A8EC]">#{entry.rank}</span>
                    <StrategyBadge strategyType={entry.strategyType} />
                  </div>
                  <h3 className="font-semibold text-white text-sm uppercase mb-1 truncate">
                    {entry.portfolioName}
                  </h3>
                  <p className="text-xs text-[#58586A] mb-3">{truncateAddress(entry.walletAddress)}</p>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${entry.totalReturnPct >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]'}`}>
                      {formatPct(entry.totalReturnPct)}
                    </span>
                    <Button size="sm" variant="outline" onClick={() => setSelected(entry)}>
                      <Copy className="w-3 h-3" /> Copy
                    </Button>
                  </div>
                </motion.div>
              ))}
        </div>
      </div>

      {/* Full board */}
      <div>
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#58586A] mb-1">Full Board</p>
          <h2 className="text-sm font-semibold text-white">All strategies available to copy</h2>
        </div>

        <div className="bg-[#1C1C21] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}
            </div>
          ) : (
            <div className="divide-y divide-[rgba(255,255,255,0.04)]">
              {allEntries.map((entry, i) => (
                <motion.div
                  key={entry.portfolioId}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.02 }}
                  className="flex items-center gap-4 px-5 py-3.5 hover:bg-[rgba(169,168,236,0.04)] transition-colors group"
                >
                  <span className="text-sm font-semibold text-[#58586A] w-8">#{entry.rank}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-semibold text-white uppercase truncate">{entry.portfolioName}</p>
                      <StrategyBadge strategyType={entry.strategyType} />
                    </div>
                    <p className="text-xs text-[#58586A]">{truncateAddress(entry.walletAddress)}</p>
                  </div>
                  <div className="flex items-center gap-6 shrink-0">
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-[#58586A]">Return</p>
                      <p className={`text-sm font-semibold ${entry.totalReturnPct >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]'}`}>
                        {formatPct(entry.totalReturnPct)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase text-[#58586A]">Copiers</p>
                      <p className="text-sm text-white flex items-center gap-1">
                        <Users className="w-3 h-3 text-[#58586A]" /> {entry.copierCount}
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
