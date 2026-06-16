import { cn } from '@/lib/cn'

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-[rgba(255,255,255,0.06)]',
        className,
      )}
      {...props}
    />
  )
}

export { Skeleton }
