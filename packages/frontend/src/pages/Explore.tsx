import { useState } from 'react'
import { Shield, TrendingUp, AlertTriangle, ArrowRight, ChevronRight, Zap, Wallet, Sliders, BarChart2, Users } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { VaultConfigModal } from '@/components/strategy/VaultConfigModal'
import { RiskDisclosure } from '@/components/common/RiskDisclosure'
import { Button } from '@/components/ui/button'
import {
  STRATEGY_NAMES, STRATEGY_DESCRIPTIONS, STRATEGY_RISK_LABELS,
  BETTOR_STRATEGIES, HOUSE_STRATEGIES, STRATEGY_COLORS,
} from '@/lib/constants'
import { cn } from '@/lib/cn'

// ── Strategy composition building blocks ─────────────────────────────────────

interface Block {
  label: string
  color: string
}

const COMPOSITION: Record<number, Block[]> = {
  0: [
    { label: 'PLP SUPPLY', color: '#A9A8EC' },
  ],
  1: [
    { label: 'PLP SUPPLY', color: '#A9A8EC' },
    { label: 'SPOT DELTA HEDGE', color: '#D4CDF9' },
  ],
  2: [
    { label: 'PLP SUPPLY', color: '#A9A8EC' },
    { label: 'SPOT DELTA HEDGE', color: '#D4CDF9' },
    { label: 'AUTO REBALANCE', color: '#A9A8EC' },
  ],
  3: [
    { label: 'SAFE LENDING', color: '#3DD68C' },
    { label: 'YIELD POOL', color: '#3DD68C' },
    { label: 'PREDICT BET', color: '#A9A8EC' },
  ],
  4: [
    { label: 'RANGE POSITION', color: '#E8A627' },
    { label: 'AUTO-ROLL', color: '#E8A627' },
  ],
  5: [
    { label: 'RANGE POSITION', color: '#E8A627' },
    { label: 'VOL-BASED SIZING', color: '#fbbf24' },
    { label: 'VOL ORACLE', color: '#A9A8EC' },
  ],
  6: [
    { label: 'REFERENCE FEED', color: '#E8A627' },
    { label: 'SELL VOLATILITY', color: '#F04438' },
    { label: 'SPOT HEDGE', color: '#A9A8EC' },
  ],
  7: [
    { label: 'COLLATERAL', color: '#F97316' },
    { label: 'BORROW', color: '#F97316' },
    { label: 'RANGE POSITION', color: '#E8A627' },
  ],
}

const HOW_IT_WORKS: Record<number, string> = {
  0: 'Your capital sits in the liquidity pool. Every time someone places a bet on BTC\'s price, you earn a fee — regardless of which direction BTC moves. No prediction required.',
  1: 'Earns the same fee income as PLP Supplier, then automatically opens a counter-trade on the spot market to cancel out any price risk the pool has built up. You earn the fee and stay price-neutral each round.',
  2: 'The easiest starting point. Splits your capital between the two passive strategies and rebalances each cycle automatically — no decisions needed on your end.',
  3: 'Your principal never touches Predict. It sits in safe lending earning yield. All depositors\' yield is pooled each cycle and placed as a single shared bet — zero principal risk.',
  4: 'Places a bet that BTC\'s price stays within a set range before the timer runs out. Once the round ends, it automatically places the next bet. Profits when markets are quiet; loses when BTC moves sharply.',
  5: 'Works like Range Roll, but automatically bets smaller when the market is turbulent and larger when it\'s calm. This one adjustment dramatically reduces how much you can lose in a volatile period.',
  6: 'Watches external market data to spot when Predict is pricing volatility higher than it should be. When a gap appears, it sells the overpriced volatility on Predict and hedges the price risk on the spot market.',
  7: 'Your deposit acts as collateral to unlock additional borrowing power. The borrowed funds are automatically placed into a range bet on Predict, amplifying your exposure. Profits are higher when markets stay calm — but losses are amplified if BTC moves sharply. Lending leg runs on a testnet mock.',
}

const ALL_TYPES = [0, 1, 2, 3, 4, 5, 6, 7]

type Filter = 'all' | 'house' | 'bettor'

// ── Bot feature definitions ───────────────────────────────────────────────────

interface Feature {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
}

const BASE_FEATURES: Feature[] = [
  { icon: Zap,     label: 'Automated — runs every expiry, no action needed' },
  { icon: Shield,  label: 'Drawdown pause — auto-stops if losses cross your threshold' },
  { icon: Wallet,  label: 'Liquidity reserve — portion always kept free for withdrawal' },
  { icon: Sliders, label: 'Position sizing — you set how much capital deploys each round' },
]

const EXTRA_FEATURES: Record<number, Feature[]> = {
  1: [{ icon: BarChart2,  label: 'Hedge multiplier — control how aggressively the bot hedges' }],
  5: [{ icon: BarChart2,  label: 'Vol-based sizing — bets smaller when markets are turbulent' }],
  7: [{ icon: TrendingUp, label: 'Leverage — borrowed capital amplifies your exposure' }],
}

// ── Strategy selector card ────────────────────────────────────────────────────

function StrategyPickCard({
  strategyType,
  selected,
  onClick,
  index,
}: {
  strategyType: number
  selected: boolean
  onClick: () => void
  index: number
}) {
  const name  = STRATEGY_NAMES[strategyType]
  const color = STRATEGY_COLORS[strategyType]
  const isHouse   = HOUSE_STRATEGIES.has(strategyType)
  const isBettor  = BETTOR_STRATEGIES.has(strategyType)
  const isLevered = strategyType === 7

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      onClick={onClick}
      className={cn(
        'w-full text-left rounded-xl p-5 transition-all duration-150 group',
        'border focus:outline-none',
        selected
          ? 'border-[var(--accent)] bg-[rgba(169,168,236,0.08)]'
          : 'border-[rgba(255,255,255,0.07)] bg-[var(--bg-card)] hover:border-[rgba(169,168,236,0.3)] hover:bg-[var(--bg-hover)]',
      )}
    >
      <div className="flex items-start justify-between mb-4">
        <span
          className="text-xs font-bold tracking-widest"
          style={{ color: color, opacity: 0.8 }}
        >
          {String(strategyType).padStart(2, '0')}
        </span>
        <div className="flex items-center gap-1.5">
          {isHouse && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(169,168,236,0.12)', color: 'var(--accent)' }}>
              House
            </span>
          )}
          {isBettor && !isLevered && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(232,166,39,0.12)', color: '#E8A627' }}>
              Short-Vol
            </span>
          )}
          {isLevered && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(249,115,22,0.12)', color: '#F97316' }}>
              Leveraged
            </span>
          )}
        </div>
      </div>

      <h3
        className="font-bold text-sm uppercase tracking-tight mb-1 transition-colors"
        style={{ color: selected ? 'var(--ink-primary)' : 'var(--ink-secondary)' }}
      >
        {name}
      </h3>

      <div className="flex items-center gap-1 mt-3 opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ color: 'var(--accent)' }}>
        <span className="text-[10px] font-semibold uppercase tracking-wider">Configure</span>
        <ChevronRight className="w-3 h-3" />
      </div>
    </motion.button>
  )
}

// ── Detail panel ─────────────────────────────────────────────────────────────

function DetailPanel({
  strategyType,
  onDeploy,
}: {
  strategyType: number
  onDeploy: () => void
}) {
  const name    = STRATEGY_NAMES[strategyType]
  const desc    = STRATEGY_DESCRIPTIONS[strategyType]
  const risk    = STRATEGY_RISK_LABELS[strategyType]
  const color   = STRATEGY_COLORS[strategyType]
  const blocks  = COMPOSITION[strategyType] ?? []
  const howTo   = HOW_IT_WORKS[strategyType] ?? desc
  const isBettor = BETTOR_STRATEGIES.has(strategyType)
  const isHouse  = HOUSE_STRATEGIES.has(strategyType)

  return (
    <motion.div
      key={strategyType}
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ duration: 0.2 }}
      className="space-y-7"
    >
      {/* Strategy number + name */}
      <div>
        <span
          className="text-xs font-bold tracking-widest block mb-3"
          style={{ color, opacity: 0.7 }}
        >
          {String(strategyType).padStart(2, '0')}
        </span>
        <h2 className="page-title text-[32px]" style={{ lineHeight: 1 }}>{name}</h2>
        <p className="text-xs mt-2 uppercase tracking-wider"
          style={{ color: isHouse ? 'var(--accent)' : strategyType === 7 ? '#F97316' : '#E8A627' }}>
          {isHouse
            ? 'Passive income — house strategy'
            : strategyType === 7
            ? 'Leveraged short-vol — amplified risk'
            : 'Market timing required — short-vol strategy'}
        </p>
      </div>

      {/* Composition blocks */}
      <div>
        <p className="section-label mb-3">Composition</p>
        <div className="flex flex-wrap gap-2">
          {blocks.map((block, i) => (
            <span
              key={i}
              className="text-[10px] font-bold uppercase tracking-widest px-3 py-1.5 rounded-full"
              style={{
                background: `${block.color}14`,
                color: block.color,
                border: `1px solid ${block.color}2a`,
              }}
            >
              {block.label}
            </span>
          ))}
        </div>
      </div>

      {/* How it works */}
      <div>
        <p className="section-label mb-3">How it works</p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--ink-secondary)' }}>
          {howTo}
        </p>
      </div>

      {/* Risk */}
      <div
        className="rounded-lg px-4 py-3 flex items-center gap-3"
        style={{
          background: isHouse ? 'rgba(169,168,236,0.06)' : 'rgba(232,166,39,0.06)',
          border: `1px solid ${isHouse ? 'rgba(169,168,236,0.15)' : 'rgba(232,166,39,0.2)'}`,
        }}
      >
        {isHouse
          ? <Shield className="w-4 h-4 shrink-0" style={{ color: 'var(--status-green)' }} />
          : <AlertTriangle className="w-4 h-4 shrink-0" style={{ color: '#E8A627' }} />
        }
        <span className="text-xs font-semibold" style={{ color: isHouse ? 'var(--status-green)' : '#fbbf24' }}>
          {risk}
        </span>
      </div>

      {/* Bot includes */}
      <div>
        <p className="section-label mb-3">Bot includes</p>
        <div className="space-y-2.5">
          {[...BASE_FEATURES, ...(EXTRA_FEATURES[strategyType] ?? [])].map(({ icon: Icon, label }, i) => (
            <div key={i} className="flex items-center gap-2.5">
              <Icon
                className="w-3.5 h-3.5 shrink-0"
                style={{ color: 'var(--accent)', opacity: 0.8 }}
              />
              <span className="text-xs leading-snug" style={{ color: 'var(--ink-secondary)' }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Bettor disclosure */}
      {isBettor && <RiskDisclosure strategyType={strategyType} />}

      {/* Deploy CTA */}
      <Button
        className="w-full btn-pill text-sm py-3"
        onClick={onDeploy}
      >
        Configure &amp; Deploy
        <ArrowRight className="w-4 h-4" />
      </Button>
    </motion.div>
  )
}

// ── Empty state for right panel ───────────────────────────────────────────────

function SelectionPrompt() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="h-full flex flex-col justify-between py-8 px-2"
    >
      {/* Top: select prompt */}
      <div className="flex flex-col items-center text-center">
        <div
          className="w-14 h-14 rounded-full flex items-center justify-center mb-5"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--line)' }}
        >
          <TrendingUp className="w-6 h-6" style={{ color: 'var(--ink-muted)' }} />
        </div>
        <p className="card-heading mb-2 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
          Select a strategy
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)', maxWidth: 200 }}>
          Pick a strategy to see how it's built and configure your deployment.
        </p>
      </div>

      {/* Bottom: platform differentiators */}
      <div className="mt-8 pt-6" style={{ borderTop: '1px solid var(--line)' }}>
        <p className="text-[10px] font-bold uppercase tracking-widest mb-4" style={{ color: 'var(--ink-muted)' }}>
          Every bot includes
        </p>
        <div className="space-y-3.5">
          {([
            { icon: Zap,    label: 'Automated execution',   sub: 'Keeper runs every expiry, no action needed' },
            { icon: Shield, label: 'Risk controls',          sub: 'Drawdown pause + liquidity reserve built in' },
            { icon: Users,  label: 'Copy & earn',            sub: 'Publish your bot — charge others to copy it' },
          ] as const).map(({ icon: Icon, label, sub }) => (
            <div key={label} className="flex items-start gap-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: 'rgba(169,168,236,0.08)', border: '1px solid rgba(169,168,236,0.12)' }}
              >
                <Icon className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
              </div>
              <div>
                <p className="text-xs font-semibold" style={{ color: 'var(--ink-secondary)' }}>{label}</p>
                <p className="text-[10px] leading-snug mt-0.5" style={{ color: 'var(--ink-muted)' }}>{sub}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </motion.div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const FILTER_LABELS: { value: Filter; label: string }[] = [
  { value: 'all',    label: 'All' },
  { value: 'house',  label: 'House — structural edge' },
  { value: 'bettor', label: 'Short-vol view' },
]

export default function Explore() {
  const [selected, setSelected]     = useState<number | null>(null)
  const [deployTarget, setDeployTarget] = useState<number | null>(null)
  const [filter, setFilter]         = useState<Filter>('all')

  const visible = ALL_TYPES.filter((t) => {
    if (filter === 'house')  return HOUSE_STRATEGIES.has(t)
    if (filter === 'bettor') return BETTOR_STRATEGIES.has(t)
    return true
  })

  return (
    <div className="px-10 py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">DEPLOY</div>
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight uppercase mb-3">Strategy Studio</h1>
      <p className="text-muted-foreground mb-12">Build, test, and deploy automated strategies on DeepBook Predict.</p>

      {/* ── Filter pills ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {FILTER_LABELS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => { setFilter(value); setSelected(null) }}
            className={cn(
              'px-4 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider transition-all',
              filter === value
                ? 'bg-[var(--accent)] text-[#0C0C14]'
                : 'border border-[var(--line)] text-[var(--ink-muted)] hover:border-[var(--line-strong)] hover:text-[var(--ink-secondary)]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Split layout ─────────────────────────────────────────────── */}
      <div className="grid gap-6 items-start" style={{ gridTemplateColumns: '3fr 2fr' }}>

        {/* Left: strategy grid */}
        <div className="min-w-0">
          <AnimatePresence mode="popLayout">
            <div className="grid grid-cols-2 gap-3">
              {visible.map((t, i) => (
                <StrategyPickCard
                  key={t}
                  strategyType={t}
                  selected={selected === t}
                  onClick={() => setSelected(selected === t ? null : t)}
                  index={i}
                />
              ))}
            </div>
          </AnimatePresence>
        </div>

        {/* Right: detail panel — sticky, fills its grid column */}
        <div
          className="sticky top-20 rounded-xl p-8"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--line)',
            minHeight: 480,
          }}
        >
          <AnimatePresence mode="wait">
            {selected === null ? (
              <SelectionPrompt key="empty" />
            ) : (
              <DetailPanel
                key={selected}
                strategyType={selected}
                onDeploy={() => setDeployTarget(selected)}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      <VaultConfigModal
        defaultStrategyType={deployTarget ?? 0}
        open={deployTarget !== null}
        onClose={() => setDeployTarget(null)}
      />
    </div>
  )
}
