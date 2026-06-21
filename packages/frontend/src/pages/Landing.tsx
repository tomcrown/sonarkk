import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, Lock, Copy, CheckCircle, Users,
} from 'lucide-react'
import { motion } from 'framer-motion'
import { LandingHeader } from '@/components/layout/Header'
import { BracketCard } from '@/components/common/BracketCard'
import FloatingLines from '@/components/ui/FloatingLines'
import SplitText from '@/components/ui/SplitText'

const MotionLink = motion(Link)

// ─── Keeper terminal data ─────────────────────────────────────────────────────

const KEEPER_LOGS = [
  { time: '00:00:00.012', type: 'ORACLE',  color: '#D4CDF9', msg: 'Round #4821 settled · BTC $67,420 · 15m expiry' },
  { time: '00:00:00.089', type: 'SETTLE',  color: '#3DD68C', msg: 'Range position redeemed · payout +$3.21 · portfolio DELTA-01' },
  { time: '00:00:00.094', type: 'COMPUTE', color: '#A9A8EC', msg: 'SVI ATM vol 28.4% · NAV $1,042.18 · next size $142' },
  { time: '00:00:00.097', type: 'RISK',    color: '#E8A627', msg: 'Policy gate passed · budget $142/$500 · drawdown 2.1%/15%' },
  { time: '00:00:00.103', type: 'EXECUTE', color: '#60a5fa', msg: 'supply PTB · PLP Supplier · portfolio DELTA-01' },
  { time: '00:00:00.118', type: 'EXECUTE', color: '#60a5fa', msg: 'hedge PTB · DeepBook Spot · sell 0.0021 BTC · 94% coverage' },
  { time: '00:00:00.241', type: 'CONFIRM', color: '#3DD68C', msg: 'tx 9xKm…7fQp · 229ms · 2 portfolios processed' },
]

const KEEPER_STEPS = [
  {
    n: '01', title: 'Oracle Settles',
    desc: 'DeepBook publishes the final price for the expired round on-chain.',
  },
  {
    n: '02', title: 'Redeem',
    desc: "Keeper claims your prior position's PnL permissionlessly. No manual action needed.",
  },
  {
    n: '03', title: 'Compute',
    desc: 'Reads the live SVI vol surface, computes NAV with real mark-to-market on open positions, sizes the next deployment.',
  },
  {
    n: '04', title: 'Execute',
    desc: 'One atomic PTB on Sui — supply to PLP, mint a range, or hedge on DeepBook Spot. Real tx hash.',
  },
]

const TRUST_MARKERS = [
  {
    title: 'Your key never leaves your hands',
    body: 'You sign once to grant a bounded PolicyCap. The keeper can only interact with Predict, up to a ceiling you set, and it expires in 30 days. A compromised keeper key can never drain your wallet.',
  },
  {
    title: 'Automated risk controls',
    body: 'Only a fraction of your balance deploys each cycle — the rest stays liquid DUSDC you can withdraw immediately. Stop-loss and drawdown pause halt new deployments if NAV falls past your threshold.',
  },
  {
    title: 'Revoke anytime',
    body: 'Destroy the PolicyCap and the keeper freezes instantly — no cooldown, no waiting. Your funds are never locked and the vault always has a keeper-independent exit.',
  },
]

// ─── Strategy data ────────────────────────────────────────────────────────────

const HOUSE_STRATEGIES = [
  {
    num: '01', label: 'PLP Supplier',
    tagline: 'Collect the spread on every bet placed — direction-agnostic income.',
    protocols: ['Predict'],
    params: 'Utilization target · liquidity reserve · drawdown pause',
  },
  {
    num: '02', label: 'Hedged PLP',
    tagline: 'PLP income + dynamic delta hedge on DeepBook Spot each round.',
    protocols: ['Predict', 'DeepBook Spot'],
    params: 'Hedge multiplier · utilization target · drawdown pause',
  },
  {
    num: '03', label: 'Smart Vault',
    tagline: 'Auto-allocates across house strategies, rebalances per vol regime.',
    protocols: ['Predict', 'DeepBook Spot'],
    params: 'Utilization target · drawdown pause',
  },
  {
    num: '04', label: 'Principal Protected',
    tagline: 'Principal locked in lending. Only accumulated yield goes to Predict.',
    protocols: ['Iron Bank', 'Predict'],
    params: 'Utilization target · liquidity reserve',
  },
  {
    num: '05', label: 'Margin Loop',
    tagline: 'Post collateral, borrow against it, deploy borrowed capital to Predict.',
    protocols: ['Iron Bank', 'DeepBook', 'Predict'],
    params: 'Strike selection · utilization target · drawdown pause',
  },
]

const BETTOR_STRATEGIES = [
  {
    num: '06', label: 'Range Roll',
    tagline: 'Mint range positions every expiry, auto-roll each cycle.',
    protocols: ['Predict'],
    params: 'Strike selection · utilization target · drawdown pause',
  },
  {
    num: '07', label: 'Vol-Targeted Range',
    tagline: 'Range positions sized to your SVI vol target. Manages tail risk vs Range Roll.',
    protocols: ['Predict'],
    params: 'Vol target · strike selection · drawdown pause',
  },
]

// ─── Other section data ───────────────────────────────────────────────────────

const STEPS = [
  {
    num: '01', title: 'Connect',
    body: 'Sui wallet or Google sign-in. No extension required.',
  },
  {
    num: '02', title: 'Configure',
    body: 'Pick a strategy, backtest it against real oracle and SVI data, set your risk parameters.',
  },
  {
    num: '03', title: 'Deploy',
    body: 'Keeper runs every expiry. NAV updates in real-time. Withdraw anytime — no lockups.',
  },
]

const POWERED_BY = [
  {
    name: 'Sui',
    logo: '/sui%20logo.png',
    desc: 'Every keeper cycle is a Sui transaction — on-chain and verifiable',
  },
  {
    name: 'DeepBook',
    logo: '/deepbook.jpeg',
    desc: 'Predict protocol for strategies · Spot order book for delta hedging',
  },
  {
    name: 'Seal',
    logo: '/seal.png',
    desc: 'Threshold encryption for private strategy configurations',
  },
  {
    name: 'Walrus',
    logo: '/walrus.jpeg',
    desc: 'Decentralized storage for strategy configs and tamper-proof daily audit snapshots',
  },
  {
    name: 'zkLogin',
    logo: '/zklogin.avif',
    desc: 'Sign in with Google — no wallet extension required, just your Google account',
  },
]

// ─── Sub-components ───────────────────────────────────────────────────────────

function KeeperTerminal() {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (count >= KEEPER_LOGS.length) {
      const t = setTimeout(() => setCount(0), 3400)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setCount(c => c + 1), count === 0 ? 700 : 380)
    return () => clearTimeout(t)
  }, [count])

  return (
    <div
      className="rounded-xl overflow-hidden border border-border/60"
      style={{ background: '#09090B' }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-5 py-3.5 border-b border-border/50"
        style={{ background: '#0D0D10' }}
      >
        <div className="flex items-center gap-2.5">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          <span className="font-mono text-[10px] tracking-[0.18em] text-text-dim">
            LIVE KEEPER FEED
          </span>
        </div>
        <span className="font-mono text-[10px] text-text-dim">keeper_worker</span>
      </div>

      {/* Log lines */}
      <div className="p-5 space-y-3.5 min-h-[300px]">
        {KEEPER_LOGS.slice(0, count).map((log, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.18 }}
            className="flex items-start gap-3 font-mono"
          >
            <span className="text-[10px] text-text-dim shrink-0 pt-px tabular-nums">
              {log.time}
            </span>
            <span
              className="shrink-0 text-[9px] font-bold tracking-widest px-1.5 py-0.5 rounded mt-px"
              style={{
                color: log.color,
                background: `${log.color}14`,
                border: `1px solid ${log.color}28`,
              }}
            >
              {log.type}
            </span>
            <span className="text-[11px] text-foreground/70 leading-relaxed">
              {log.msg}
            </span>
          </motion.div>
        ))}

        {/* Blinking cursor while typing */}
        {count > 0 && count < KEEPER_LOGS.length && (
          <motion.span
            animate={{ opacity: [1, 0, 1] }}
            transition={{ duration: 0.9, repeat: Infinity }}
            className="inline-block w-1.5 h-3.5 bg-accent/40 align-middle"
          />
        )}
      </div>
    </div>
  )
}

function ProtocolTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-full border border-border/70 text-[9px] tracking-[0.08em] text-text-dim bg-surface-2/40">
      {label}
    </span>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Landing() {
  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-hidden noise-grain">
      <LandingHeader />

      {/* ── 1. Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative min-h-screen flex flex-col items-center justify-center px-6 pt-24 pb-32">
        <FloatingLines
          enabledWaves={['bottom', 'top', 'middle']}
          lineCount={6}
          lineDistance={16.5}
          bendRadius={8}
          bendStrength={-9.5}
          interactive
          parallax={true}
          animationSpeed={1.6}
          linesGradient={['#635f5f', '#6e61c1', '#262628']}
        />
        <div className="absolute inset-0 bg-background/50 pointer-events-none" />

        <div className="relative z-10 max-w-5xl text-center mt-20">
          {/* Pill */}
          {/* <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="inline-flex items-center gap-2 mb-8 px-4 py-1.5 rounded-full border border-border bg-card/50 backdrop-blur text-xs text-muted-foreground"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            Live on Sui testnet · keeper runs every expiry
          </motion.div> */}

          {/* Headline */}
          <h1 className="text-5xl md:text-7xl font-display font-medium tracking-tight leading-[1.05]">
            <SplitText
              text="The Strategy Platform"
              tag="span"
              delay={28}
              duration={1.1}
              staggerStart={0.3}
              className="block"
              gradient
            />
            <SplitText
              text="for DeepBook Predict"
              tag="span"
              delay={28}
              duration={1.1}
              staggerStart={0.96}
              className="block"
              gradient
            />
          </h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 1.8, ease: 'easeOut' }}
            className="mt-8 text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed"
          >
            Configure, backtest, deploy, and copy automated strategies. Full visibility into what you're running and why — every cycle is on-chain.
          </motion.p>

          {/* Buttons */}
          <div className="mt-10 flex items-center justify-center gap-3 flex-wrap">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 2.1, ease: 'easeOut' }}
            >
              <MotionLink
                to="/explore"
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-full overflow-hidden bg-gradient-to-r from-accent-light to-accent text-background font-medium"
                whileTap={{ scale: 0.97 }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-500"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)',
                  }}
                />
                <span className="relative z-10 inline-flex items-center gap-2">
                  Deploy a strategy <ArrowRight className="w-4 h-4" />
                </span>
              </MotionLink>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 2.25, ease: 'easeOut' }}
            >
              <motion.div whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <Link
                  to="/leaderboard"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-full border border-border text-foreground hover:bg-surface-2 hover:border-accent/30 transition-colors"
                >
                  Browse leaderboard
                </Link>
              </motion.div>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── 2. Keeper ───────────────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-24 md:py-32 max-w-7xl mx-auto">
        <div className="text-xs tracking-[0.18em] text-text-dim mb-10">THE KEEPER</div>

        <div className="grid lg:grid-cols-2 gap-16 items-start mb-16">
          {/* Steps */}
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <h2 className="text-4xl md:text-5xl font-display tracking-tight text-gradient-accent leading-tight mb-6">
              Every expiry.<br />Every cycle.<br />Automatic.
            </h2>
            <p className="text-muted-foreground leading-relaxed mb-12">
              DeepBook Predict settles every 15–60 minutes. Without automation, you'd need to watch for oracle events, settle your own position, and submit a new trade within seconds — every single expiry. The keeper does all of it, automatically, with no wallet connection required after you deploy.
            </p>

            <div className="space-y-9">
              {KEEPER_STEPS.map((step, i) => (
                <motion.div
                  key={step.n}
                  initial={{ opacity: 0, x: -22 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ delay: i * 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                  className="flex gap-5"
                >
                  <span className="font-mono text-sm text-accent-light shrink-0 w-7 mt-0.5">
                    {step.n}
                  </span>
                  <div className="w-5 h-px bg-border mt-3 shrink-0" />
                  <div>
                    <div className="text-sm font-semibold text-foreground mb-1">{step.title}</div>
                    <div className="text-sm text-muted-foreground leading-relaxed">{step.desc}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>

          {/* Terminal */}
          <motion.div
            initial={{ opacity: 0, x: 32 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-40px' }}
            transition={{ duration: 0.6, delay: 0.08, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <KeeperTerminal />
          </motion.div>
        </div>

        {/* Trust markers */}
        <div className="grid md:grid-cols-3 gap-4">
          {TRUST_MARKERS.map((m, i) => (
            <motion.div
              key={m.title}
              initial={{ opacity: 0, y: 18, scale: 0.96 }}
              whileInView={{ opacity: 1, y: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="rounded-xl border border-border bg-card/40 p-5"
            >
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle className="w-3.5 h-3.5 text-success shrink-0" />
                <span className="text-sm font-semibold text-foreground">{m.title}</span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{m.body}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── 3. Strategies ───────────────────────────────────────────────────── */}
      <section className="py-24 md:py-32" style={{ background: 'var(--bg-surface)' }}>
        <div className="max-w-7xl mx-auto px-6 md:px-16">
          <motion.div
            initial={{ opacity: 0, y: 28 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="mb-14"
          >
            <div className="text-xs tracking-[0.18em] text-text-dim mb-4">STRATEGIES</div>
            <h2 className="text-4xl md:text-5xl font-display tracking-tight text-gradient-accent leading-tight mb-4">
              Be the house.<br />Or take a position.
            </h2>
            <p className="text-muted-foreground max-w-lg leading-relaxed">
              Two sides to every market. We tell you which one you're on — and what the risks are — before you deposit.
            </p>
          </motion.div>

          <div className="grid lg:grid-cols-[3fr_2fr] gap-10">
            {/* House */}
            <div>
              <div className="flex items-center gap-3 mb-7">
                <span
                  className="text-[10px] tracking-[0.18em] font-semibold shrink-0"
                  style={{ color: '#3DD68C' }}
                >
                  HOUSE — STRUCTURAL EDGE
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="grid sm:grid-cols-2 gap-4">
                {HOUSE_STRATEGIES.map((s, i) => (
                  <motion.div
                    key={s.num}
                    initial={{ opacity: 0, y: 22, scale: 0.97 }}
                    whileInView={{ opacity: 1, y: 0, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.08, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
                    className="h-full"
                  >
                    <BracketCard className="h-full flex flex-col">
                      <span className="font-mono text-xs text-accent-light mb-3">{s.num}</span>
                      <div className="font-semibold text-sm text-foreground mb-1.5">{s.label}</div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-4 flex-1">
                        {s.tagline}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {s.protocols.map(p => <ProtocolTag key={p} label={p} />)}
                      </div>
                      <div className="pt-3 border-t border-border/50">
                        <span className="text-[9px] text-text-dim tracking-wide">
                          TUNE: {s.params}
                        </span>
                      </div>
                    </BracketCard>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Bettor */}
            <div>
              <div className="flex items-center gap-3 mb-7">
                <span
                  className="text-[10px] tracking-[0.18em] font-semibold shrink-0"
                  style={{ color: '#E8A627' }}
                >
                  BETTOR — SHORT-VOL
                </span>
                <div className="h-px flex-1 bg-border" />
              </div>
              <div className="space-y-4">
                {BETTOR_STRATEGIES.map((s, i) => (
                  <motion.div
                    key={s.num}
                    initial={{ opacity: 0, x: 20, scale: 0.97 }}
                    whileInView={{ opacity: 1, x: 0, scale: 1 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
                  >
                    <BracketCard className="flex flex-col">
                      <span
                        className="font-mono text-xs mb-3"
                        style={{ color: '#E8A627' }}
                      >
                        {s.num}
                      </span>
                      <div className="font-semibold text-sm text-foreground mb-1.5">
                        {s.label}
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed mb-4">
                        {s.tagline}
                      </p>
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {s.protocols.map(p => <ProtocolTag key={p} label={p} />)}
                      </div>
                      <div className="pt-3 border-t border-border/50">
                        <span className="text-[9px] text-text-dim tracking-wide">
                          TUNE: {s.params}
                        </span>
                      </div>
                    </BracketCard>
                  </motion.div>
                ))}
              </div>

     
            </div>
          </div>
        </div>
      </section>

      {/* ── 4. Copy + Seal ──────────────────────────────────────────────────── */}
      <section className="px-6 md:px-16 py-24 md:py-32 max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
          className="mb-12"
        >
          <div className="text-xs tracking-[0.18em] text-text-dim mb-4">COPY TRADING</div>
          <h2 className="text-4xl md:text-5xl font-display tracking-tight text-gradient-accent leading-tight">
            Mirror what's working.<br />Keep your edge private.
          </h2>
        </motion.div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Copier — large card */}
          <motion.div
            initial={{ opacity: 0, x: -28, scale: 0.97 }}
            whileInView={{ opacity: 1, x: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="h-full"
          >
            <BracketCard className="h-full flex flex-col">
              <div className="flex items-center gap-3 mb-6">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{
                    background: 'rgba(169,168,236,0.1)',
                    border: '1px solid rgba(169,168,236,0.2)',
                  }}
                >
                  <Copy className="w-5 h-5 text-accent" />
                </div>
                <div>
                  <div className="text-[10px] tracking-[0.15em] text-text-dim mb-0.5">
                    FOR COPIERS
                  </div>
                  <div className="font-semibold text-foreground text-sm">Browse & mirror</div>
                </div>
              </div>

              <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                Browse real on-chain performance — not claimed numbers. Copy any public strategy in one transaction. Same config, same keeper, your wallet.
              </p>

              <div className="space-y-3 flex-1">
                {[
                  'Every result is a Sui transaction — verify it on-chain',
                  'Identical config and keeper run in your own wallet',
                  'Set your own deposit size and risk parameters independently',
                ].map(pt => (
                  <div key={pt} className="flex items-start gap-2.5">
                    <CheckCircle className="w-3.5 h-3.5 text-success shrink-0 mt-0.5" />
                    <span className="text-xs text-muted-foreground leading-relaxed">{pt}</span>
                  </div>
                ))}
              </div>

              <Link
                to="/copy-trading"
                className="mt-8 inline-flex items-center gap-2 text-sm text-accent-light hover:text-accent transition-colors"
              >
                Browse strategies <ArrowRight className="w-4 h-4" />
              </Link>
            </BracketCard>
          </motion.div>

          {/* Creator + Seal — stacked */}
          <div className="flex flex-col gap-5">
            <motion.div
              initial={{ opacity: 0, x: 28, scale: 0.97 }}
              whileInView={{ opacity: 1, x: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
            >
              <BracketCard>
                <div className="flex items-center gap-3 mb-5">
                  <div
                    className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{
                      background: 'rgba(61,214,140,0.08)',
                      border: '1px solid rgba(61,214,140,0.18)',
                    }}
                  >
                    <Users className="w-5 h-5 text-success" />
                  </div>
                  <div>
                    <div className="text-[10px] tracking-[0.15em] text-text-dim mb-0.5">
                      FOR CREATORS
                    </div>
                    <div className="font-semibold text-foreground text-sm">Monetise your edge</div>
                  </div>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  Mark your strategy private and set a copy fee. Copiers pay once, get identical execution, and never see your logic. Your alpha stays yours.
                </p>
              </BracketCard>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 28 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.12, ease: [0.25, 0.46, 0.45, 0.94] }}
              className="rounded-xl border p-6 flex-1"
              style={{
                borderColor: 'rgba(169,168,236,0.15)',
                background: 'rgba(169,168,236,0.04)',
              }}
            >
              <div className="flex items-center gap-2.5 mb-3">
                <Lock className="w-4 h-4 text-accent shrink-0" />
                <span className="text-sm font-semibold text-foreground">
                  Encrypted with Seal · Stored on Walrus
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your strategy config is encrypted using Seal's threshold encryption and stored permanently on Walrus. The blob is public — only the decryption key isn't. Access requires a valid on-chain proof, enforced by Seal's key servers.
              </p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ── 5. Get started ──────────────────────────────────────────────────── */}
      <section className="py-24 md:py-32" style={{ background: 'var(--bg-surface)' }}>
        <div className="max-w-4xl mx-auto px-6 md:px-16">
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="text-center mb-16"
          >
            <div className="text-xs tracking-[0.18em] text-text-dim mb-4">GET STARTED</div>
            <h2 className="text-4xl md:text-5xl font-display tracking-tight text-gradient-accent">
              From zero to deployed<br />in minutes
            </h2>
          </motion.div>

          <div>
            {STEPS.map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, x: i % 2 === 0 ? -24 : 24 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1, duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="flex items-start gap-8 py-8 border-b border-border last:border-0"
              >
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 font-mono text-sm font-bold"
                  style={{
                    background: 'rgba(169,168,236,0.08)',
                    border: '1px solid rgba(169,168,236,0.18)',
                    color: '#D4CDF9',
                  }}
                >
                  {step.num}
                </div>
                <div className="pt-2.5">
                  <div className="font-semibold text-foreground text-lg mb-1">{step.title}</div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 6. Powered by ───────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden" style={{ background: '#ffffff' }}>
        {/* Purple glow — bottom left */}
        <div
          className="pointer-events-none absolute bottom-0 left-0 w-[700px] h-[500px]"
          style={{
            background: 'radial-gradient(ellipse at bottom left, rgba(169,168,236,0.55) 0%, rgba(169,168,236,0.40) 50%, transparent 70%)',
          }}
          aria-hidden
        />

        <div className="relative max-w-7xl mx-auto px-6 md:px-16 py-24 md:py-32">
          {/* Header */}
          <motion.div
            initial={{ opacity: 0, y: 28, scale: 0.98 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.55, ease: [0.25, 0.46, 0.45, 0.94] }}
            className="mb-16"
          >
            <div
              className="text-xs tracking-[0.18em] font-semibold mb-4"
              style={{ color: '#A9A8EC' }}
            >
              BUILT ON
            </div>
            <h2
              className="text-4xl md:text-5xl font-display tracking-tight leading-tight"
              style={{ color: '#121213' }}
            >
              The best infrastructure<br />on Sui
            </h2>
          </motion.div>

          {/* 3-column grid with divider lines (5 items: 3+2) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 overflow-hidden">
            {POWERED_BY.map(({ name, logo, desc }, i) => (
              <motion.div
                key={name}
                initial={{ opacity: 0, y: 22, scale: 0.96 }}
                whileInView={{ opacity: 1, y: 0, scale: 1 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08, duration: 0.45, ease: [0.25, 0.46, 0.45, 0.94] }}
                className="p-8 md:p-12"
                style={{
                  borderTop: '1px solid rgba(0,0,0,0.08)',
                  borderRight: '1px solid rgba(0,0,0,0.08)',
                }}
              >
                <img
                  src={logo}
                  alt={name}
                  className="h-10 w-auto object-contain mb-6"
                />
                <div
                  className="text-2xl font-display font-semibold mb-3 tracking-tight"
                  style={{ color: '#121213' }}
                >
                  {name}
                </div>
                <p className="text-sm leading-relaxed" style={{ color: '#58586A' }}>
                  {desc}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── 7. CTA ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 py-36 text-center">
        <FloatingLines
          enabledWaves={['bottom', 'top', 'middle']}
          lineCount={6}
          lineDistance={16.5}
          bendRadius={8}
          bendStrength={-9.5}
          interactive
          parallax={true}
          animationSpeed={1.6}
          linesGradient={['#635f5f', '#6e61c1', '#262628']}
        />
        <div className="absolute inset-0 bg-background/50 pointer-events-none" />
        <div className="relative z-10 max-w-3xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 32, scale: 0.97 }}
            whileInView={{ opacity: 1, y: 0, scale: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, ease: [0.25, 0.46, 0.45, 0.94] }}
          >
            <h2 className="text-4xl md:text-6xl font-display tracking-tight text-gradient-accent">
              Your strategy.<br />Your keeper.<br />Your keys.
            </h2>
            <p className="mt-6 text-muted-foreground text-lg">
              Connect and deploy in minutes.
            </p>
            <MotionLink
              to="/dashboard"
              className="group mt-10 relative inline-flex items-center gap-2 px-7 py-3.5 rounded-full overflow-hidden bg-gradient-to-r from-accent-light to-accent text-background font-medium"
              whileTap={{ scale: 0.97 }}
            >
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-500"
                style={{
                  background:
                    'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.22) 50%, transparent 70%)',
                }}
              />
              <span className="relative z-10 inline-flex items-center gap-2">
                Launch app <ArrowRight className="w-4 h-4" />
              </span>
            </MotionLink>
          </motion.div>
        </div>
      </section>

      <footer className="border-t border-border px-8 py-10 flex items-center justify-between text-xs text-text-dim flex-wrap gap-4">
        <span>© 2026 Sonark Labs</span>
        <span className="font-mono">v0.4 · Sui testnet</span>
      </footer>
    </div>
  )
}
