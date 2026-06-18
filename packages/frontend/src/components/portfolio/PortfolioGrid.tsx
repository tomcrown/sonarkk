import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { type PortfolioListItem } from '@/lib/api'
import { formatDusdc, formatNav, formatDate } from '@/lib/format'
import { PortfolioCard } from './PortfolioCard'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { Badge } from '@/components/ui/badge'

// ── Multi-strategy bot group card ─────────────────────────────────────────────

export function BotGroupCard({ portfolios }: { portfolios: PortfolioListItem[] }) {
  const navigate = useNavigate()
  const first = portfolios[0]!
  const name = first.name.replace(/ #\d+$/, '')
  const combinedTvlRaw = String(
    portfolios.reduce((sum, p) => sum + BigInt(p.totalDepositedRaw ?? '0'), 0n)
  )
  const totalCycles = portfolios.reduce((sum, p) => sum + p.cycleCount, 0)
  const isPaused = portfolios.every((p) => p.isPaused)

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="bg-[#1C1C21] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 cursor-pointer hover:border-[rgba(169,168,236,0.25)] hover:bg-[#202026] transition-all"
      onClick={() => navigate(`/portfolios/${first.id}`)}
      role="article"
      aria-label={`Bot: ${name}`}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/portfolios/${first.id}`)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-white text-sm mb-2 truncate">{name}</h3>
          <div className="flex flex-wrap gap-1">
            {portfolios.map((p) => (
              <StrategyBadge key={p.id} strategyType={p.strategyType} showName={false} />
            ))}
          </div>
        </div>
        <Badge variant={isPaused ? 'paused' : 'live'} className="shrink-0 ml-2">
          {isPaused ? 'Paused' : 'Active'}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-1">TVL</p>
          <p className="text-sm font-semibold text-white">{formatDusdc(combinedTvlRaw, 0)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-1">NAV/Share</p>
          <p className="text-sm font-semibold text-white">{formatNav(first.navPerShareRaw)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-1">Cycles</p>
          <p className="text-sm font-semibold text-white">{totalCycles}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-[10px] text-[#58586A]">{portfolios.length} strategies</span>
        <span className="text-[10px] text-[#58586A]">· Deployed {formatDate(first.createdAt)}</span>
      </div>
    </motion.div>
  )
}

// ── Portfolio grid (groups multi-strategy bots by vaultConfigId) ──────────────

export function PortfolioGrid({
  portfolios,
  gap = '5',
}: {
  portfolios: PortfolioListItem[]
  gap?: '4' | '5'
}) {
  const seen = new Set<string>()
  const items: Array<
    { type: 'single'; portfolio: PortfolioListItem } |
    { type: 'group'; portfolios: PortfolioListItem[] }
  > = []

  const groups: Record<string, PortfolioListItem[]> = {}
  for (const p of portfolios) {
    if (p.vaultConfigId) {
      groups[p.vaultConfigId] ??= []
      groups[p.vaultConfigId]!.push(p)
    }
  }

  for (const p of portfolios) {
    if (seen.has(p.id)) continue
    if (p.vaultConfigId && (groups[p.vaultConfigId]?.length ?? 0) > 1) {
      for (const member of groups[p.vaultConfigId]!) seen.add(member.id)
      items.push({ type: 'group', portfolios: groups[p.vaultConfigId]! })
    } else {
      seen.add(p.id)
      items.push({ type: 'single', portfolio: p })
    }
  }

  const gapClass = gap === '4' ? 'gap-4' : 'gap-5'

  return (
    <div className={`grid md:grid-cols-2 xl:grid-cols-3 ${gapClass}`}>
      {items.map((item, i) =>
        item.type === 'group' ? (
          <motion.div
            key={item.portfolios[0]!.vaultConfigId}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <BotGroupCard portfolios={item.portfolios} />
          </motion.div>
        ) : (
          <motion.div
            key={item.portfolio.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.06 }}
          >
            <Link to={`/portfolios/${item.portfolio.id}`}>
              <PortfolioCard portfolio={item.portfolio} />
            </Link>
          </motion.div>
        )
      )}
    </div>
  )
}
