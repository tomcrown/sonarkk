import * as React from 'react'
import { cn } from '@/lib/cn'

const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          'flex h-9 w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-sm text-white shadow-sm transition-colors',
          'placeholder:text-[#58586A]',
          'hover:border-[rgba(169,168,236,0.3)]',
          'focus-visible:outline-none focus-visible:border-[#A9A8EC] focus-visible:ring-1 focus-visible:ring-[rgba(169,168,236,0.3)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'file:border-0 file:bg-transparent file:text-sm file:font-medium',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Input.displayName = 'Input'

export { Input }
