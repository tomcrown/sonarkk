import { type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/cn'

interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  /** Pass a ReactNode (button, link) or a simple {label, onClick} object */
  action?: React.ReactNode | { label: string; onClick: () => void }
  className?: string
}

function isSimpleAction(a: unknown): a is { label: string; onClick: () => void } {
  return typeof a === 'object' && a !== null && 'label' in a && 'onClick' in a
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-6 text-center', className)}>
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-[rgba(169,168,236,0.1)] border border-[rgba(169,168,236,0.2)] flex items-center justify-center mb-4">
          <Icon className="w-5 h-5 text-[#A9A8EC]" />
        </div>
      )}
      <h3 className="text-base font-semibold text-white mb-1.5">{title}</h3>
      {description && (
        <p className="text-sm text-[#58586A] max-w-xs mb-5">{description}</p>
      )}
      {action && (
        isSimpleAction(action) ? (
          <Button variant="outline" size="sm" onClick={action.onClick}>
            {action.label}
          </Button>
        ) : (
          action
        )
      )}
    </div>
  )
}
