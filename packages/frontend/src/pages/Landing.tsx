import { Link } from 'react-router-dom'
import { ArrowRight, Shield, Zap, Users } from 'lucide-react'
import { motion } from 'framer-motion'
import { LandingHeader } from '@/components/layout/Header'
import { useLeaderboard } from '@/hooks/useLeaderboard'
import { formatPct, truncateAddress } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'

const FEATURES = [
  {
    num: '01',
    title: 'Be the House',
    body: 'Supply to the binary options liquidity pool and collect the spread on every bet — direction-agnostic income that rises in volatile markets.\n\nDeploy once. The keeper runs every ~2 hour expiry for you.',
    icon: Shield,
  },
  {
    num: '02',
    title: 'Simulate Before You Ship',
    body: 'Backtest any strategy against real oracle and SVI data. See drawdowns and regime analysis before risking a single DUSDC.\n\nDeploy confidently or tune first.',
    icon: Zap,
  },
  {
    num: '03',
    title: 'Copy Top Strategies',
    body: "Every strategy is on-chain and verifiable. Browse the leaderboard, see real on-chain performance, and mirror any creator's config in one payment — no trust required.",
    icon: Users,
  },
]

const STRATEGIES = [
  {
    label: 'PLP Supplier',
    tagline: 'Collect the spread',
    description: 'Supplies capital to the options pool. Earns the bid-ask spread from every bet placed — fully direction-agnostic.',
    type: 'House strategy',
  },
  {
    label: 'Hedged PLP',
    tagline: 'House + delta hedge',
    description: 'Earns PLP spread income, then hedges the pool\'s net directional exposure on DeepBook Spot each round.',
    type: 'House strategy',
  },
  {
    label: 'Smart Vault',
    tagline: 'Auto-allocated default',
    description: 'Allocates automatically across PLP Supplier and Hedged PLP, rebalancing each cycle based on vol regime.',
    type: 'House strategy',
  },
]

const HONEST_POINTS = [
  { label: 'House strategies',        description: 'Structural edge — collects the spread regardless of BTC direction', positive: true },
  { label: 'Range Roll / Vol-Targeted', description: 'Short-vol view — profitable in calm markets, loses in vol spikes', positive: false },
  { label: 'Principal Protected',      description: 'Principal never touches the options protocol — enforced on-chain',  positive: true },
  { label: 'All data on-chain',        description: 'Every keeper cycle is a Sui transaction. Every number is verifiable.', positive: true },
]

export default function Landing() {
  const { data: leaderboard } = useLeaderboard(5)

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden noise-grain">
      <LandingHeader />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-32">
        {/* Glow layers */}
        <div className="absolute inset-0 hero-glow" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90%] max-w-5xl h-[55%] pointer-events-none">
          <div className="absolute inset-0 [background:conic-gradient(from_90deg_at_50%_0%,transparent_0deg,rgba(169,168,236,0.35)_140deg,rgba(212,205,249,0.55)_180deg,rgba(169,168,236,0.35)_220deg,transparent_360deg)] [mask-image:linear-gradient(to_bottom,black_0%,transparent_70%)] blur-2xl opacity-80" />
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: 'easeOut' }}
          className="relative max-w-5xl text-center mt-20"
        >
          <div className="inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full border border-border bg-card/50 backdrop-blur text-xs text-muted-foreground">
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            Live on Sui testnet · keeper runs every ~2h
          </div>

          <h1 className="text-5xl md:text-7xl font-display font-medium tracking-tight text-gradient-accent leading-[1.05]">
            Deploy, simulate, and copy<br />automated strategies on Sui
          </h1>

          <p className="mt-8 text-lg text-muted-foreground max-w-2xl mx-auto">
            No-code strategy automation on DeepBook Predict. Be the house, collect the spread — or copy the strategies that are working.
          </p>

          <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
            <Link
              to="/explore"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gradient-to-r from-accent-light to-accent text-background font-medium hover:opacity-90 transition-opacity"
            >
              Deploy your first strategy <ArrowRight className="w-4 h-4" />
            </Link>
            <Link
              to="/leaderboard"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-foreground hover:bg-card transition-colors"
            >
              Browse leaderboard
            </Link>
          </div>
        </motion.div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-32 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5 }}
          className="mb-20 max-w-3xl"
        >
          <h2 className="text-4xl md:text-5xl font-display tracking-tight text-gradient-accent leading-tight">
            Built for efficiency,<br />not complexity
          </h2>
          <p className="mt-6 text-muted-foreground text-lg">
            DeFi option automation that actually makes sense.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-10">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.num}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              className="space-y-6"
            >
              <div className="font-mono text-xl text-accent-light">{f.num}</div>
              <div className="h-px bg-border" />
              <h3 className="text-xl font-display">{f.title}</h3>
              <p className="text-muted-foreground text-sm leading-relaxed whitespace-pre-line">{f.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Strategy preview ──────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-32 max-w-7xl mx-auto">
        <div className="text-xs tracking-[0.18em] text-text-dim mb-4">STRATEGIES</div>
        <h2 className="text-4xl md:text-6xl font-display tracking-tight text-gradient-accent leading-[1.05]">
          Endless DeFi possibilities
        </h2>
        <p className="mt-6 text-muted-foreground text-lg max-w-xl">
          From passive house income to principal-protected yield — choose your risk profile.
        </p>

        <div className="mt-16 grid md:grid-cols-3 gap-6">
          {STRATEGIES.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`bracket-card-full rounded-lg bg-card/60 p-8 ${i === 1 ? 'md:scale-105 shadow-glow' : ''}`}
            >
              <span className="bracket-bl" />
              <span className="bracket-br" />
              <div className="h-36 mb-8 rounded-md flex items-center justify-center bg-gradient-to-br from-accent/10 to-transparent border border-border/40">
                <div className="text-accent-light font-display text-3xl font-medium opacity-40">
                  0{i + 1}
                </div>
              </div>
              <div className="text-[10px] tracking-[0.15em] text-accent mb-2">{s.type.toUpperCase()}</div>
              <h3 className="text-xl font-display mb-2">{s.label}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{s.description}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Honest section ────────────────────────────────────────────────── */}
      <section className="py-32" style={{ background: 'var(--bg-surface)' }}>
        <div className="max-w-7xl mx-auto px-6 md:px-16">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <div>
              <div className="text-xs tracking-[0.18em] text-accent mb-4">TRANSPARENT BY DESIGN</div>
              <h2 className="text-4xl md:text-5xl font-display tracking-tight leading-tight mb-6">
                We tell you which<br />strategies lose money
              </h2>
              <p className="text-muted-foreground leading-relaxed">
                Every strategy is labeled with its regime conditions. The regime analysis table shows exactly when each strategy earns and when it doesn't. No hidden asterisks — before you deposit.
              </p>
            </div>
            <div className="space-y-3">
              {HONEST_POINTS.map(({ label, description, positive }) => (
                <div
                  key={label}
                  className="flex gap-3 items-start rounded-lg p-4 bg-card border border-border"
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
                    <p className="font-semibold text-sm text-foreground">{label}</p>
                    <p className="text-xs mt-0.5 text-muted-foreground">{description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── Leaderboard teaser ────────────────────────────────────────────── */}
      {leaderboard && leaderboard.entries.length > 0 && (
        <section className="px-6 md:px-16 py-32 max-w-7xl mx-auto">
          <div className="flex items-end justify-between mb-12 flex-wrap gap-6">
            <div>
              <div className="text-xs tracking-[0.18em] text-text-dim mb-4">LEADERBOARD</div>
              <h2 className="text-4xl md:text-5xl font-display tracking-tight">
                Top strategies, ranked live
              </h2>
            </div>
            <Link
              to="/leaderboard"
              className="inline-flex items-center gap-2 text-sm text-accent-light hover:text-accent transition-colors"
            >
              See full leaderboard <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          {leaderboard.caveat && (
            <div className="rounded-lg px-4 py-3 mb-6 flex gap-2 border border-border bg-card/50">
              <p className="text-xs text-muted-foreground">{leaderboard.caveat}</p>
            </div>
          )}

          <div className="border border-border rounded-lg overflow-hidden bg-card">
            <div className="grid grid-cols-12 px-6 py-3 text-[10px] tracking-[0.15em] text-text-dim bg-card/50 border-b border-border">
              <div className="col-span-1">#</div>
              <div className="col-span-5">STRATEGY</div>
              <div className="col-span-3 text-right">STRATEGY TYPE</div>
              <div className="col-span-3 text-right">RETURN</div>
            </div>
            {leaderboard.entries.slice(0, 5).map((entry, i) => (
              <motion.div
                key={entry.portfolioId}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.06 }}
                className="grid grid-cols-12 px-6 py-4 items-center border-b border-border last:border-0 hover:bg-surface-2/40 transition-colors"
              >
                <div className="col-span-1 font-mono text-text-dim">#{i + 1}</div>
                <div className="col-span-5">
                  <div className="font-medium text-foreground uppercase text-sm truncate">{entry.portfolioName}</div>
                  <div className="text-xs text-text-dim font-mono">{truncateAddress(entry.walletAddress)}</div>
                </div>
                <div className="col-span-3 text-right text-xs text-muted-foreground">
                  {STRATEGY_NAMES[entry.strategyType]}
                </div>
                <div className={`col-span-3 text-right font-mono text-sm ${(entry.totalReturnPct ?? 0) >= 0 ? 'text-success' : 'text-danger'}`}>
                  {entry.totalReturnPct != null ? formatPct(entry.totalReturnPct) : '—'}
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="px-6 py-32 text-center max-w-3xl mx-auto">
        <h2 className="text-4xl md:text-6xl font-display tracking-tight text-gradient-accent">
          Let the bots cook.
        </h2>
        <p className="mt-6 text-muted-foreground text-lg">
          Connect a wallet or sign in with Google. No extension required.
        </p>
        <Link
          to="/dashboard"
          className="mt-10 inline-flex items-center gap-2 px-7 py-3.5 rounded-full bg-gradient-to-r from-accent-light to-accent text-background font-medium hover:opacity-90 transition-opacity"
        >
          Launch app <ArrowRight className="w-4 h-4" />
        </Link>
      </section>

      <footer className="border-t border-border px-8 py-10 flex items-center justify-between text-xs text-text-dim">
        <span>© 2026 Sonark Labs</span>
        <span className="font-mono">v0.4 · Sui testnet</span>
      </footer>
    </div>
  )
}
