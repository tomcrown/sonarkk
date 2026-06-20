import { motion } from 'framer-motion'

interface SplitTextProps {
  text: string
  className?: string
  delay?: number
  duration?: number
  staggerStart?: number
  tag?: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'p' | 'span'
  gradient?: boolean
}

const GRADIENT = 'linear-gradient(135deg, rgba(255,255,255,0.95), #D4CDF9, #A9A8EC)'

export default function SplitText({
  text,
  className = '',
  delay = 28,
  duration = 1.1,
  staggerStart = 0,
  tag = 'span',
  gradient = false,
}: SplitTextProps) {
  const Tag = tag as React.ElementType
  const chars = text.split('')

  const charStyle: React.CSSProperties = gradient
    ? {
        background: GRADIENT,
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        backgroundClip: 'text',
        display: 'inline-block',
      }
    : { display: 'inline-block' }

  return (
    <Tag className={`inline-block ${className}`}>
      {chars.map((char, i) => (
        <motion.span
          key={i}
          style={charStyle}
          initial={{ opacity: 0, y: 48, rotateX: -20 }}
          animate={{ opacity: 1, y: 0, rotateX: 0 }}
          transition={{
            duration,
            delay: staggerStart + i * (delay / 1000),
            ease: [0.19, 1, 0.22, 1],
          }}
        >
          {char === ' ' ? ' ' : char}
        </motion.span>
      ))}
    </Tag>
  )
}
