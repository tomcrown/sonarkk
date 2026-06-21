import { Users, Copy } from 'lucide-react'
import { motion } from 'framer-motion'
import { type LeaderboardEntry } from '@/lib/api'
import { formatDusdc, formatApy, formatPct, truncateAddress } from '@/lib/format'
import { STRATEGY_NAMES, BETTOR_STRATEGIES } from '@/lib/constants'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

function displayReturn(pct: number | null): string {
  return pct != null ? formatPct(pct) : '—'
}

function displayApy(pct: number | null): string {
  return pct != null ? formatApy(pct) : '—'
}

interface LeaderboardTableProps {
  entries: LeaderboardEntry[]
  onCopy?: (entry: LeaderboardEntry) => void
}

export function LeaderboardTable({ entries, onCopy }: LeaderboardTableProps) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full" aria-label="Strategy leaderboard">
        <thead>
          <tr className="border-b border-[rgba(255,255,255,0.06)]">
            {['#', 'Strategy', 'Creator', 'TVL', 'Return', 'APY', 'Cycles', 'Copiers', ''].map((h) => (
              <th
                key={h}
                scope="col"
                className="pb-3 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#58586A] pr-4 first:pr-2"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {entries.map((entry, idx) => (
            <motion.tr
              key={entry.portfolioId}
              initial={{ opacity: 0, x: -4 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.03 }}
              className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(169,168,236,0.04)] transition-colors group"
            >
              {/* Rank */}
              <td className="py-3.5 pr-2">
                <span className={`text-sm font-semibold ${idx < 3 ? 'text-[#A9A8EC]' : 'text-[#58586A]'}`}>
                  #{entry.rank}
                </span>
              </td>

              {/* Strategy name + badge */}
              <td className="py-3.5 pr-4">
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-semibold text-white uppercase">
                    {entry.portfolioName}
                  </span>
                  <div className="flex items-center gap-1.5">
                    <StrategyBadge strategyType={entry.strategyType} />
                    {BETTOR_STRATEGIES.has(entry.strategyType) && (
                      <Badge variant="bettor">Short vol</Badge>
                    )}
                  </div>
                </div>
              </td>

              {/* Creator */}
              <td className="py-3.5 pr-4">
                <span className="text-xs font-mono text-[#9191A4]">
                  {truncateAddress(entry.walletAddress)}
                </span>
              </td>

              {/* TVL */}
              <td className="py-3.5 pr-4">
                <span className="text-sm text-white">{formatDusdc(entry.tvlRaw, 0)}</span>
              </td>

              {/* Return */}
              <td className="py-3.5 pr-4">
                <span className={`text-sm font-semibold ${(entry.totalReturnPct ?? 0) >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]'}`}>
                  {displayReturn(entry.totalReturnPct)}
                </span>
              </td>

              {/* APY */}
              <td className="py-3.5 pr-4">
                <span className="text-sm text-[#9191A4]">{displayApy(entry.rollingApyPct)}</span>
              </td>

              {/* Cycles */}
              <td className="py-3.5 pr-4">
                <span className="text-sm text-[#9191A4]">{entry.cycleCount}</span>
              </td>

              {/* Copiers */}
              <td className="py-3.5 pr-4">
                <div className="flex items-center gap-1.5">
                  <Users className="w-3 h-3 text-[#58586A]" />
                  <span className="text-sm text-[#9191A4]">{entry.copierCount}</span>
                </div>
              </td>

              {/* Actions */}
              <td className="py-3.5">
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {onCopy && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onCopy(entry)}
                      className="text-xs"
                    >
                      <Copy className="w-3 h-3" />
                      Copy
                    </Button>
                  )}
                </div>
              </td>
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
