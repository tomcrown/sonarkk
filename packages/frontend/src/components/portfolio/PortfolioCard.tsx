import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { type PortfolioListItem } from '@/lib/api'
import { formatDusdc, formatPct, timeAgo } from '@/lib/format'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { Badge } from '@/components/ui/badge'

interface PortfolioCardProps {
  portfolio: PortfolioListItem
}

export function PortfolioCard({ portfolio }: PortfolioCardProps) {
  const navigate = useNavigate()
  const returnPct = portfolio.totalReturnPct
  const returnPositive = (returnPct ?? 0) >= 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="bg-card border border-border rounded-xl p-5 cursor-pointer hover:border-accent/25 hover:bg-surface-2 transition-all"
      onClick={() => navigate(`/portfolios/${portfolio.id}`)}
      role="article"
      aria-label={`Portfolio: ${portfolio.name}`}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/portfolios/${portfolio.id}`)}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-foreground text-sm mb-1">{portfolio.name}</h3>
          <StrategyBadge strategyType={portfolio.strategyType} />
        </div>
        <Badge variant={portfolio.isPaused ? 'paused' : 'live'}>
          {portfolio.isPaused ? 'Paused' : 'Active'}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">Deposit</p>
          <p className="text-sm font-semibold text-foreground">
            {formatDusdc(portfolio.totalDepositedRaw, 0)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">Return</p>
          <p className={`text-sm font-semibold ${returnPct == null ? 'text-text-dim' : returnPositive ? 'text-success' : 'text-danger'}`}>
            {returnPct == null ? '—' : formatPct(returnPct)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-text-dim mb-1">Last run</p>
          <p className="text-sm font-semibold text-foreground">
            {timeAgo(portfolio.lastKeeperRun)}
          </p>
        </div>
      </div>
    </motion.div>
  )
}
