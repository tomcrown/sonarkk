import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A9A8EC] focus-visible:ring-offset-2 focus-visible:ring-offset-[#121213] disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-[#A9A8EC] text-white shadow-[0_0_20px_rgba(169,168,236,0.3)] hover:bg-[#8F8DD9] hover:shadow-[0_0_28px_rgba(169,168,236,0.45)] active:scale-[0.98]',
        outline:
          'border border-[rgba(255,255,255,0.12)] bg-transparent text-white hover:bg-[rgba(169,168,236,0.1)] hover:border-[rgba(169,168,236,0.4)]',
        ghost:
          'bg-transparent text-[#9191A4] hover:bg-[rgba(169,168,236,0.08)] hover:text-white',
        destructive:
          'bg-[#F04438] text-white hover:bg-[#D6392E]',
        success:
          'bg-[#3DD68C] text-white hover:bg-[#2EB876]',
        pill:
          'rounded-full bg-[#A9A8EC] text-white shadow-[0_0_20px_rgba(169,168,236,0.35)] hover:bg-[#8F8DD9] hover:shadow-[0_0_28px_rgba(169,168,236,0.5)] hover:-translate-y-px active:translate-y-0',
        'pill-outline':
          'rounded-full border border-[rgba(255,255,255,0.15)] bg-transparent text-white hover:border-[rgba(169,168,236,0.5)] hover:bg-[rgba(169,168,236,0.08)]',
        link: 'text-[#A9A8EC] underline-offset-4 hover:underline p-0 h-auto',
      },
      size: {
        default: 'h-9 px-4 py-2',
        sm: 'h-7 rounded-md px-3 text-xs',
        lg: 'h-11 rounded-md px-6 text-base',
        xl: 'h-12 rounded-md px-8 text-base',
        icon: 'h-9 w-9',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    )
  },
)
Button.displayName = 'Button'

export { Button, buttonVariants }
