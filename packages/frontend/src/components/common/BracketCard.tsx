import { motion } from 'framer-motion'
import { cn } from '@/lib/cn'

interface BracketCardProps {
  children: React.ReactNode
  className?: string
  active?: boolean
  onClick?: () => void
}

export function BracketCard({ children, className, active, onClick }: BracketCardProps) {
  const cornerVariants = {
    rest:    { borderColor: active ? 'rgba(169,168,236,0.65)' : 'rgba(169,168,236,0.28)' },
    hovered: { borderColor: active ? '#c4c2f0'               : 'rgba(169,168,236,0.62)' },
  }

  return (
    <motion.div
      className={cn('relative p-5 rounded', onClick && 'cursor-pointer', className)}
      style={{
        background: active ? 'rgba(169,168,236,0.05)' : 'var(--bg-card)',
        backgroundImage: 'linear-gradient(160deg, rgba(255,255,255,0.022) 0%, transparent 55%)',
      }}
      initial="rest"
      whileHover="hovered"
      variants={{
        rest: {
          y: 0,
          boxShadow: active
            ? '0 0 0 1px rgba(169,168,236,0.22), 0 4px 16px rgba(0,0,0,0.4)'
            : '0 1px 2px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.05)',
        },
        hovered: {
          y: -4,
          boxShadow: active
            ? '0 0 0 1px rgba(169,168,236,0.42), 0 14px 40px rgba(0,0,0,0.6), 0 0 32px rgba(169,168,236,0.16)'
            : '0 10px 36px rgba(0,0,0,0.55), 0 0 0 1px rgba(169,168,236,0.22), 0 0 28px rgba(169,168,236,0.1)',
        },
      }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onClick={onClick}
    >
      {/* Radial glow overlay — fades in on hover via variant propagation */}
      <motion.div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded"
        variants={{ rest: { opacity: 0 }, hovered: { opacity: 1 } }}
        transition={{ duration: 0.25 }}
        style={{
          background:
            'radial-gradient(ellipse at 15% 15%, rgba(169,168,236,0.09) 0%, transparent 65%)',
        }}
      />

      {/* Corner brackets — brightness animates with the parent hover variant */}
      <motion.span
        aria-hidden
        className="pointer-events-none absolute top-0 left-0 w-3 h-3 border-t border-l"
        variants={cornerVariants}
        transition={{ duration: 0.15 }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute top-0 right-0 w-3 h-3 border-t border-r"
        variants={cornerVariants}
        transition={{ duration: 0.15 }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute bottom-0 left-0 w-3 h-3 border-b border-l"
        variants={cornerVariants}
        transition={{ duration: 0.15 }}
      />
      <motion.span
        aria-hidden
        className="pointer-events-none absolute bottom-0 right-0 w-3 h-3 border-b border-r"
        variants={cornerVariants}
        transition={{ duration: 0.15 }}
      />

      {children}
    </motion.div>
  )
}
