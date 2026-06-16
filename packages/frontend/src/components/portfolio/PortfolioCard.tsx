import { useNavigate } from 'react-router-dom'
import { Clock, Layers } from 'lucide-react'
import { motion } from 'framer-motion'
import { type PortfolioListItem } from '@/lib/api'
import { formatDusdc, formatNav, formatDate } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { Badge } from '@/components/ui/badge'

interface PortfolioCardProps {
  portfolio: PortfolioListItem
}

export function PortfolioCard({ portfolio }: PortfolioCardProps) {
  const navigate = useNavigate()

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className="bg-[#1C1C21] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 cursor-pointer hover:border-[rgba(169,168,236,0.25)] hover:bg-[#202026] transition-all"
      onClick={() => navigate(`/portfolios/${portfolio.id}`)}
      role="article"
      aria-label={`Portfolio: ${portfolio.name}`}
      tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && navigate(`/portfolios/${portfolio.id}`)}
    >
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="font-semibold text-white text-sm mb-1">{portfolio.name}</h3>
          <StrategyBadge strategyType={portfolio.strategyType} />
        </div>
        <Badge variant={portfolio.isPaused ? 'paused' : 'live'}>
          {portfolio.isPaused ? 'Paused' : 'Active'}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-1">TVL</p>
          <p className="text-sm font-semibold text-white">
            {formatDusdc(portfolio.totalDepositedRaw, 0)}
          </p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-1">NAV/Share</p>
          <p className="text-sm font-semibold text-white">{formatNav(portfolio.navPerShareRaw)}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-1">Cycles</p>
          <p className="text-sm font-semibold text-white">{portfolio.cycleCount}</p>
        </div>
      </div>

      <div className="flex items-center gap-1 mt-4 text-[10px] text-[#58586A]">
        <Clock className="w-3 h-3" />
        <span>Deployed {formatDate(portfolio.createdAt)}</span>
      </div>
    </motion.div>
  )
}
