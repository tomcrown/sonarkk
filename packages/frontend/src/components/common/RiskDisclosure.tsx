import { AlertTriangle } from 'lucide-react'
import { BETTOR_STRATEGIES, BETTOR_DISCLOSURE } from '@/lib/constants'
import { cn } from '@/lib/cn'

interface RiskDisclosureProps {
  strategyType: number
  className?: string
  compact?: boolean
}

export function RiskDisclosure({ strategyType, className, compact }: RiskDisclosureProps) {
  if (!BETTOR_STRATEGIES.has(strategyType)) return null

  return (
    <div
      role="alert"
      aria-label="Risk disclosure"
      className={cn(
        'flex gap-3 rounded-lg border border-[rgba(245,158,11,0.3)] bg-[rgba(245,158,11,0.08)] p-3',
        compact ? 'items-center' : 'items-start',
        className,
      )}
    >
      <AlertTriangle className="w-4 h-4 text-[#E8A627] shrink-0 mt-0.5" aria-hidden />
      <p className={cn('text-[#fbbf24]', compact ? 'text-xs' : 'text-sm')}>
        {BETTOR_DISCLOSURE}
      </p>
    </div>
  )
}
