import { Link } from 'react-router-dom'
import { ArrowRight, Shield, Users, Zap } from 'lucide-react'
import { motion } from 'framer-motion'
import { LandingHeader } from '@/components/layout/Header'
import { BracketCard } from '@/components/common/BracketCard'
import { useLeaderboard } from '@/hooks/useLeaderboard'
import { formatPct, truncateAddress } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'

const FEATURES = [
  {
    n: '01',
    title: 'Be the House',
    body: 'Supply to the binary options liquidity pool and collect the spread on every bet — direction-agnostic income that actually increases in volatile markets.',
    icon: Shield,
  },
  {
    n: '02',
    title: 'Fully Automated',
    body: 'The keeper runs every ~2 hour expiry for you. Deploy once, walk away. Revoke authorization instantly with a single on-chain action.',
    icon: Zap,
  },
  {
    n: '03',
    title: 'Copy Top Strategies',
    body: 'Browse the leaderboard. Every number is a verifiable on-chain transaction. Copy any creator\'s strategy config with one payment — no trust required.',
    icon: Users,
  },
]

const HONEST_POINTS = [
  { label: 'House strategies', description: 'Structural edge — collects the spread regardless of BTC direction', positive: true },
  { label: 'Range Roll / Vol-Targeted', description: 'Short-vol view — profitable in calm markets, loses in vol spikes', positive: false },
  { label: 'Principal Protected', description: 'Principal never touches the options protocol — enforced on-chain', positive: true },
  { label: 'All data on-chain', description: 'Every keeper cycle is a Sui transaction. Every performance number is verifiable.', positive: true },
]

export default function Landing() {
  const { data: leaderboard } = useLeaderboard(3)

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)', color: 'var(--ink-primary)' }}>
      <LandingHeader />

      {/* Hero */}
      <section className="relative min-h-screen flex flex-col items-center justify-end pb-24 overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 70% 55% at 50% 0%, rgba(169,168,236,0.16) 0%, rgba(169,168,236,0.05) 42%, transparent 72%)',
          }}
          aria-hidden
        />
        <div
          className="absolute inset-0 pointer-events-none opacity-[0.025]"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)',
            backgroundSize: '60px 60px',
          }}
          aria-hidden
        />

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="relative z-10 text-center px-6 max-w-3xl"
        >
          <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] font-[300] leading-[1.1] tracking-[-0.02em] mb-6">
            <span style={{ color: 'var(--ink-primary)' }}>Automate, deploy, and copy</span>
            <br />
            <span className="gradient-text font-[400]">DeFi option strategies</span>
          </h1>
          <p className="text-lg mb-10 max-w-xl mx-auto leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
            No-code strategy automation on DeepBook Predict. Be the house, collect the spread — or copy the strategies that are working.
          </p>
          <div className="flex items-center justify-center gap-4 flex-wrap">
            <Link to="/dashboard" className="btn-pill text-[15px] px-7 py-3">
              Launch App
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/leaderboard"
              className="rounded-full border px-7 py-3 text-[15px] transition-all"
              style={{ borderColor: 'var(--line-strong)', color: 'var(--ink-secondary)' }}
            >
              View Leaderboard
            </Link>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section className="py-24 px-8 max-w-6xl mx-auto">
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-16"
        >
          <h2 className="text-4xl font-bold mb-3" style={{ color: 'var(--ink-primary)' }}>Built for efficiency,<br />not complexity</h2>
          <p className="text-lg" style={{ color: 'var(--ink-secondary)' }}>DeFi options automation that actually makes sense</p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-8">
          {FEATURES.map(({ n, title, body, icon: Icon }, i) => (
            <motion.div
              key={n}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
            >
              <span className="stat-num mb-6 block" style={{ color: 'var(--ink-faint)', fontSize: '15px' }}>{n}</span>
              <div className="flex items-start gap-3 mb-3">
                <Icon className="w-5 h-5 shrink-0 mt-0.5" style={{ color: 'var(--accent)' }} />
                <h3 className="text-lg font-semibold" style={{ color: 'var(--ink-primary)' }}>{title}</h3>
              </div>
              <p className="leading-relaxed text-sm" style={{ color: 'var(--ink-secondary)' }}>{body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Strategy cards */}
      <section className="py-24 px-8 max-w-6xl mx-auto">
        <div className="mb-12">
          <h2 className="text-4xl font-bold gradient-text mb-3">Endless strategy possibilities</h2>
          <p style={{ color: 'var(--ink-secondary)' }}>From passive house income to active vol-arb — choose your risk profile</p>
        </div>

        <div className="grid md:grid-cols-4 gap-6">
          {[
            { type: 0, label: 'PLP Supplier', tagline: 'Collect the spread', house: true },
            { type: 1, label: 'Hedged PLP', tagline: 'House + delta hedge', house: true },
            { type: 2, label: 'Smart Vault', tagline: 'Auto-allocated default', house: true },
            { type: 3, label: 'Principal Protected', tagline: 'Zero principal risk', house: true },
          ].map(({ type, label, tagline, house }, i) => (
            <motion.div
              key={type}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
            >
              <BracketCard className="h-full">
                <p className="text-[10px] font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--accent)' }}>
                  {house ? 'House strategy' : 'Bettor strategy'}
                </p>
                <h4 className="font-semibold mb-1" style={{ color: 'var(--ink-primary)' }}>{label}</h4>
                <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>{tagline}</p>
              </BracketCard>
            </motion.div>
          ))}
        </div>
      </section>

      {/* Honest performance section */}
      <section className="py-24" style={{ background: 'var(--bg-surface)' }}>
        <div className="max-w-6xl mx-auto px-8">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <p className="section-label mb-4" style={{ color: 'var(--accent)' }}>Transparent by design</p>
              <h2 className="text-4xl font-bold mb-4" style={{ color: 'var(--ink-primary)' }}>
                We tell you which strategies lose money — before you deposit
              </h2>
              <p className="leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
                Every strategy is labeled with its regime conditions. The regime analysis table shows exactly when each strategy earns and when it doesn't. No hidden asterisks.
              </p>
            </div>
            <div className="space-y-3">
              {HONEST_POINTS.map(({ label, description, positive }) => (
                <div
                  key={label}
                  className="flex gap-3 items-start rounded-lg p-4"
                  style={{ background: 'var(--bg-card)', boxShadow: '0 0 0 1px var(--line)' }}
                >
                  <div
                    className="w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5"
                    style={{ background: positive ? 'rgba(61,214,140,0.15)' : 'rgba(232,166,39,0.15)' }}
                  >
                    <div
                      className="w-2 h-2 rounded-full"
                      style={{ background: positive ? 'var(--status-green)' : 'var(--status-yellow)' }}
                    />
                  </div>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: 'var(--ink-primary)' }}>{label}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--ink-secondary)' }}>{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Live leaderboard preview */}
      {leaderboard && leaderboard.entries.length > 0 && (
        <section className="py-24 px-8 max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h2 className="text-3xl font-bold mb-1" style={{ color: 'var(--ink-primary)' }}>Live Leaderboard</h2>
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>Verifiable on-chain performance</p>
            </div>
            <Link to="/leaderboard" className="text-sm flex items-center gap-1 transition-colors" style={{ color: 'var(--accent)' }}>
              View all <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          {/* Caveat */}
          <div
            className="flex gap-2 rounded-lg px-4 py-3 mb-6"
            style={{ boxShadow: '0 0 0 1px var(--accent-border)', background: 'var(--accent-muted)' }}
          >
            <p className="text-xs" style={{ color: 'var(--ink-secondary)' }}>{leaderboard.caveat}</p>
          </div>

          <div className="space-y-3">
            {leaderboard.entries.slice(0, 3).map((entry, i) => (
              <motion.div
                key={entry.portfolioId}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="flex items-center gap-4 rounded-lg px-5 py-4 transition-colors surface"
              >
                <span
                  className="text-lg font-bold w-8 shrink-0"
                  style={{ color: i === 0 ? 'var(--accent)' : 'var(--ink-muted)' }}
                >
                  #{i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate uppercase" style={{ color: 'var(--ink-primary)' }}>{entry.portfolioName}</p>
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{STRATEGY_NAMES[entry.strategyType]} · {truncateAddress(entry.walletAddress)}</p>
                </div>
                <div className="text-right">
                  <p
                    className="font-bold text-sm"
                    style={{ color: (entry.totalReturnPct ?? 0) >= 0 ? 'var(--status-green)' : 'var(--status-red)' }}
                  >
                    {entry.totalReturnPct != null ? formatPct(entry.totalReturnPct) : '—'}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{entry.cycleCount} cycles</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* CTA footer */}
      <section className="py-24 px-8 text-center relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse 60% 70% at 50% 100%, rgba(169,168,236,0.10) 0%, transparent 60%)',
          }}
          aria-hidden
        />
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="relative z-10 max-w-xl mx-auto"
        >
          <h2 className="text-4xl font-bold mb-4" style={{ color: 'var(--ink-primary)' }}>Automate your strategy on Sui.</h2>
          <p className="mb-8" style={{ color: 'var(--ink-secondary)' }}>
            Connect your wallet or sign in with Google. No extension required.
          </p>
          <Link to="/dashboard" className="btn-pill text-base px-8 py-3.5 inline-flex">
            Get Started
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </section>
    </div>
  )
}
