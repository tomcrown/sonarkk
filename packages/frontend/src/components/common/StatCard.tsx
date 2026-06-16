import { type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { Skeleton } from '@/components/ui/skeleton'

interface StatCardProps {
  label: string
  value: React.ReactNode
  subtitle?: string
  icon?: LucideIcon
  trend?: 'up' | 'down' | 'neutral'
  loading?: boolean
  className?: string
}

export function StatCard({ label, value, subtitle, icon: Icon, trend, loading, className }: StatCardProps) {
  return (
    <div
      className={cn('surface flex flex-col gap-3 p-4', className)}
    >
      <div className="flex items-center justify-between">
        <span className="section-label">{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5" style={{ color: 'var(--ink-faint)' }} />}
      </div>

      {loading ? (
        <>
          <Skeleton className="h-7 w-24" style={{ background: 'var(--bg-hover)' }} />
          <Skeleton className="h-3 w-32" style={{ background: 'var(--bg-hover)' }} />
        </>
      ) : (
        <>
          <div
            className="stat-num"
            style={{
              color: trend === 'up'
                ? 'var(--status-green)'
                : trend === 'down'
                ? 'var(--status-red)'
                : 'var(--ink-primary)',
            }}
          >
            {value}
          </div>
          {subtitle && (
            <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{subtitle}</p>
          )}
        </>
      )}
    </div>
  )
}
