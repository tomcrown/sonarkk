import { STRATEGY_NAMES, BETTOR_STRATEGIES, HOUSE_STRATEGIES } from '@/lib/constants'
import { Badge } from '@/components/ui/badge'

interface StrategyBadgeProps {
  strategyType: number
  showName?: boolean
}

export function StrategyBadge({ strategyType, showName = true }: StrategyBadgeProps) {
  const name = STRATEGY_NAMES[strategyType] ?? `Strategy ${strategyType}`
  const variant = BETTOR_STRATEGIES.has(strategyType)
    ? 'bettor'
    : HOUSE_STRATEGIES.has(strategyType)
      ? 'house'
      : 'muted'

  if (!showName) {
    return (
      <Badge variant={variant}>
        {variant === 'house' ? 'House' : variant === 'bettor' ? 'Bettor' : 'Demo'}
      </Badge>
    )
  }

  return <Badge variant={variant}>{name}</Badge>
}
