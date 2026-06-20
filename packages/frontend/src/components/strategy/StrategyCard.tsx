import { ArrowRight, Shield, TrendingUp, AlertTriangle } from 'lucide-react'
import { motion } from 'framer-motion'
import {
  STRATEGY_NAMES, STRATEGY_DESCRIPTIONS, STRATEGY_RISK_LABELS,
  BETTOR_STRATEGIES, HOUSE_STRATEGIES, STRATEGY_COLORS, STRATEGY_PROTOCOLS,
} from '@/lib/constants'
import { BracketCard } from '@/components/common/BracketCard'
import { Button } from '@/components/ui/button'

interface StrategyCardProps {
  strategyType: number
  onDeploy: (strategyType: number) => void
  index?: number
}

export function StrategyCard({ strategyType, onDeploy, index = 0 }: StrategyCardProps) {
  const name = STRATEGY_NAMES[strategyType] ?? `Strategy ${strategyType}`
  const desc = STRATEGY_DESCRIPTIONS[strategyType] ?? ''
  const risk = STRATEGY_RISK_LABELS[strategyType] ?? ''
  const color = STRATEGY_COLORS[strategyType] ?? '#A9A8EC'
  const protocols = STRATEGY_PROTOCOLS[strategyType] ?? []
  const isBettor = BETTOR_STRATEGIES.has(strategyType)
  const isHouse = HOUSE_STRATEGIES.has(strategyType)

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.25 }}
    >
      <BracketCard className="h-full flex flex-col gap-4">
        {/* Strategy number + icon */}
        <div className="flex items-start justify-between">
          <span className="section-number" style={{ color, borderColor: `${color}44` }}>
            {String(strategyType).padStart(2, '0')}
          </span>
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: `${color}1a` }}
          >
            {isBettor ? (
              <TrendingUp className="w-4 h-4" style={{ color }} />
            ) : (
              <Shield className="w-4 h-4" style={{ color }} />
            )}
          </div>
        </div>

        {/* Name */}
        <div>
          <h3 className="text-base font-semibold text-white mb-1.5">{name}</h3>
          <p className="text-sm text-[#9191A4] leading-relaxed">{desc}</p>
        </div>

        {/* Protocol tags — composability proof */}
        {protocols.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {protocols.map((p) => (
              <span
                key={p.name}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-full border"
                style={{ color: p.color, borderColor: `${p.color}44`, background: `${p.color}0f` }}
              >
                <span className="w-1 h-1 rounded-full inline-block" style={{ background: p.color }} />
                {p.name}
              </span>
            ))}
          </div>
        )}

        {/* Risk label */}
        <div className="flex items-center gap-1.5 text-xs">
          {isBettor ? (
            <AlertTriangle className="w-3.5 h-3.5 text-[#E8A627]" />
          ) : (
            <Shield className="w-3.5 h-3.5 text-[#3DD68C]" />
          )}
          <span className={isBettor ? 'text-[#fbbf24]' : 'text-[#4ade80]'}>{risk}</span>
        </div>

        {/* Bettor disclosure */}
        {isBettor && (
          <div className="flex items-start gap-2 rounded-lg border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.07)] px-3 py-2.5">
            <AlertTriangle className="w-3.5 h-3.5 text-[#E8A627] shrink-0 mt-0.5" aria-hidden />
            <p className="text-xs text-[#fbbf24] leading-relaxed">
              Short-volatility strategy — profitable in calm markets, loses in volatility spikes.
            </p>
          </div>
        )}

        <div className="mt-auto">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDeploy(strategyType)}
            className="w-full"
          >
            Deploy Strategy
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </BracketCard>
    </motion.div>
  )
}
