import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center rounded-sm px-2 py-0.5 text-[10px] font-600 uppercase tracking-wider transition-colors',
  {
    variants: {
      variant: {
        default: 'bg-[rgba(169,168,236,0.15)] text-[#D4CDF9] border border-[rgba(169,168,236,0.25)]',
        house: 'bg-[rgba(169,168,236,0.15)] text-[#D4CDF9] border border-[rgba(169,168,236,0.25)]',
        bettor: 'bg-[rgba(245,158,11,0.15)] text-[#fbbf24] border border-[rgba(245,158,11,0.25)]',
        success: 'bg-[rgba(34,197,94,0.15)] text-[#4ade80] border border-[rgba(34,197,94,0.25)]',
        danger: 'bg-[rgba(239,68,68,0.15)] text-[#F47C72] border border-[rgba(239,68,68,0.25)]',
        muted: 'bg-[rgba(255,255,255,0.06)] text-[#58586A] border border-[rgba(255,255,255,0.08)]',
        live: 'bg-[rgba(34,197,94,0.12)] text-[#4ade80] border border-[rgba(34,197,94,0.2)]',
        paused: 'bg-[rgba(245,158,11,0.12)] text-[#fbbf24] border border-[rgba(245,158,11,0.2)]',
        stopped: 'bg-[rgba(239,68,68,0.12)] text-[#F47C72] border border-[rgba(239,68,68,0.2)]',
      },
    },
    defaultVariants: { variant: 'default' },
  },
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
