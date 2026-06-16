import * as React from 'react'
import { cn } from '@/lib/cn'

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => {
    return (
      <textarea
        className={cn(
          'flex min-h-[80px] w-full rounded-md border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-sm text-white shadow-sm transition-colors resize-none',
          'placeholder:text-[#58586A]',
          'hover:border-[rgba(169,168,236,0.3)]',
          'focus-visible:outline-none focus-visible:border-[#A9A8EC] focus-visible:ring-1 focus-visible:ring-[rgba(169,168,236,0.3)]',
          'disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        ref={ref}
        {...props}
      />
    )
  },
)
Textarea.displayName = 'Textarea'

export { Textarea }
