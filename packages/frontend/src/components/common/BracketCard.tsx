import { cn } from '@/lib/cn'

const CORNER_PASSIVE = 'rgba(169,168,236,0.28)'
const CORNER_ACTIVE  = 'rgba(169,168,236,0.65)'

interface BracketCardProps {
  children: React.ReactNode
  className?: string
  active?: boolean
  onClick?: () => void
}

export function BracketCard({ children, className, active, onClick }: BracketCardProps) {
  const cc = active ? CORNER_ACTIVE : CORNER_PASSIVE

  return (
    <div
      className={cn(
        'relative p-5 rounded transition-all duration-150',
        onClick && 'cursor-pointer',
        className,
      )}
      style={{
        background: active ? 'rgba(169,168,236,0.05)' : 'var(--bg-card)',
        backgroundImage: 'linear-gradient(160deg, rgba(255,255,255,0.022) 0%, transparent 55%)',
        boxShadow: active
          ? '0 0 0 1px rgba(169,168,236,0.22), 0 4px 16px rgba(0,0,0,0.4)'
          : '0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05)',
      }}
      onClick={onClick}
    >
      {/* Top-left */}
      <span
        className="pointer-events-none absolute top-0 left-0 w-3 h-3 border-t border-l"
        style={{ borderColor: cc }}
        aria-hidden
      />
      {/* Top-right */}
      <span
        className="pointer-events-none absolute top-0 right-0 w-3 h-3 border-t border-r"
        style={{ borderColor: cc }}
        aria-hidden
      />
      {/* Bottom-left */}
      <span
        className="pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-b border-l"
        style={{ borderColor: cc }}
        aria-hidden
      />
      {/* Bottom-right */}
      <span
        className="pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-b border-r"
        style={{ borderColor: cc }}
        aria-hidden
      />
      {children}
    </div>
  )
}
