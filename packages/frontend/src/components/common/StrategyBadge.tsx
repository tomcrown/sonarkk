import { STRATEGY_NAMES, BETTOR_STRATEGIES, HOUSE_STRATEGIES } from '@/lib/constants'
import { Badge } from '@/components/ui/badge'

interface StrategyBadgeProps {
  strategyType: number | number[]
  showName?: boolean
}

function badgeVariant(t: number) {
  return BETTOR_STRATEGIES.has(t) ? 'bettor' : HOUSE_STRATEGIES.has(t) ? 'house' : 'muted'
}

export function StrategyBadge({ strategyType, showName = true }: StrategyBadgeProps) {
  if (Array.isArray(strategyType)) {
    return (
      <>
        {strategyType.map((t) => {
          const variant = badgeVariant(t)
          const label = showName
            ? (STRATEGY_NAMES[t] ?? `Strategy ${t}`)
            : (variant === 'house' ? 'House' : variant === 'bettor' ? 'Bettor' : 'Demo')
          return <Badge key={t} variant={variant}>{label}</Badge>
        })}
      </>
    )
  }

  const variant = badgeVariant(strategyType)
  const name = STRATEGY_NAMES[strategyType] ?? `Strategy ${strategyType}`

  if (!showName) {
    return (
      <Badge variant={variant}>
        {variant === 'house' ? 'House' : variant === 'bettor' ? 'Bettor' : 'Demo'}
      </Badge>
    )
  }

  return <Badge variant={variant}>{name}</Badge>
}
