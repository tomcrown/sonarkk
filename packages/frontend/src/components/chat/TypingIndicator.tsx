import { motion } from 'framer-motion'

export function TypingIndicator() {
  return (
    <div className="flex gap-3 items-start">
      {/* Avatar with sonar rings */}
      <div className="relative shrink-0 mt-1">
        {/* Radiating rings */}
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="absolute inset-0 rounded-full border border-[#A9A8EC]"
            initial={{ scale: 1, opacity: 0.5 }}
            animate={{ scale: 2.8, opacity: 0 }}
            transition={{
              duration: 1.8,
              repeat: Infinity,
              delay: i * 0.6,
              ease: 'easeOut',
            }}
          />
        ))}

        {/* Core avatar */}
        <motion.div
          className="relative w-7 h-7 rounded-full bg-gradient-to-br from-[#A9A8EC] to-[#7B79D9] flex items-center justify-center shadow-[0_0_10px_rgba(169,168,236,0.35)]"
          animate={{ boxShadow: ['0 0 10px rgba(169,168,236,0.3)', '0 0 20px rgba(169,168,236,0.6)', '0 0 10px rgba(169,168,236,0.3)'] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
        >
          <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M8 2L9.5 6.5H14L10.5 9L12 13.5L8 11L4 13.5L5.5 9L2 6.5H6.5L8 2Z" fill="currentColor" />
          </svg>
        </motion.div>
      </div>

      {/* Wave dots */}
      <div className="flex items-center gap-1 pt-2.5" aria-label="Copilot is thinking">
        {[0, 1, 2, 3].map((i) => (
          <motion.span
            key={i}
            className="w-1 h-1 rounded-full bg-[#A9A8EC]"
            animate={{ y: [0, -5, 0], opacity: [0.3, 1, 0.3] }}
            transition={{
              duration: 0.9,
              repeat: Infinity,
              delay: i * 0.15,
              ease: 'easeInOut',
            }}
          />
        ))}
      </div>
    </div>
  )
}
