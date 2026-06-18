import { useState } from 'react'
import { Shield, TrendingUp, AlertTriangle, ArrowRight, ChevronRight } from 'lucide-react'
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
    { label: 'RANGE MINT', color: '#E8A627' },
    { label: 'AUTO-ROLL', color: '#E8A627' },
  ],
  5: [
    { label: 'RANGE MINT', color: '#E8A627' },
    { label: 'VOL SIZING', color: '#fbbf24' },
    { label: 'SVI ORACLE', color: '#A9A8EC' },
  ],
  6: [
    { label: 'REFERENCE FEED', color: '#E8A627' },
    { label: 'SELL VOL', color: '#F04438' },
    { label: 'SPOT HEDGE', color: '#A9A8EC' },
  ],
}

const HOW_IT_WORKS: Record<number, string> = {
  0: 'Supplies capital to the PLP vault every expiry. Earns the bid-ask spread from every bet placed against the pool — fully direction-agnostic.',
  1: 'Earns PLP spread income, then measures the pool\'s net directional exposure and opens an opposing position on DeepBook Spot to stay delta-neutral each round.',
  2: 'The intelligent default. Allocates automatically across PLP Supplier and Hedged PLP, rebalancing each cycle based on vol regime and utilisation.',
  3: 'Your principal never touches Predict. It sits in safe lending earning yield. All depositors\' yield is pooled each cycle and placed as a single shared bet — zero principal risk.',
  4: 'Mints a price range contract each expiry, betting BTC stays inside the range. Auto-rolls into the next expiry after settlement.',
  5: 'Same range-mint approach as Range Roll but sizes each position relative to SVI-implied volatility — dramatically reducing tail losses in high-vol periods.',
  6: 'Monitors Hyperliquid as a reference feed. When Predict prices more implied vol than the reference, sells vol on Predict and hedges delta on DeepBook Spot.',
}

const ALL_TYPES = [0, 1, 2, 3, 4, 5, 6]

type Filter = 'all' | 'house' | 'bettor'

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
  const isHouse  = HOUSE_STRATEGIES.has(strategyType)
  const isBettor = BETTOR_STRATEGIES.has(strategyType)
  const isAdmin  = strategyType === 7

  return (
    <motion.button
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.2 }}
      onClick={onClick}
      disabled={isAdmin}
      className={cn(
        'w-full text-left rounded-xl p-5 transition-all duration-150 group',
        'border focus:outline-none',
        selected
          ? 'border-[var(--accent)] bg-[rgba(169,168,236,0.08)]'
          : 'border-[rgba(255,255,255,0.07)] bg-[var(--bg-card)] hover:border-[rgba(169,168,236,0.3)] hover:bg-[var(--bg-hover)]',
        isAdmin && 'opacity-40 cursor-not-allowed',
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
          {isBettor && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(232,166,39,0.12)', color: '#E8A627' }}>
              Short-Vol
            </span>
          )}
          {isAdmin && (
            <span className="text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--ink-muted)' }}>
              Admin
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
          style={{ color: isHouse ? 'var(--accent)' : '#E8A627' }}>
          {isHouse ? 'Structural edge — house strategy' : 'Short-volatility view — bettor strategy'}
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
      className="h-full flex flex-col items-center justify-center text-center py-16 px-6"
    >
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
        style={{ background: 'var(--bg-elevated)', border: '1px solid var(--line)' }}
      >
        <TrendingUp className="w-7 h-7" style={{ color: 'var(--ink-muted)' }} />
      </div>
      <p className="card-heading mb-3 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
        Select a strategy
      </p>
      <p className="text-xs leading-relaxed" style={{ color: 'var(--ink-muted)', maxWidth: 200 }}>
        Pick a strategy from the left to see its composition and configure your deployment.
      </p>
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
    <div className="space-y-8">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <p className="section-label mb-3">Studio</p>
        <h1 className="page-title">Strategy Studio</h1>
        <p className="text-sm mt-3" style={{ color: 'var(--ink-secondary)' }}>
          Build, test, and deploy automated strategies on DeepBook Predict.
        </p>
      </div>

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
      <div className="flex gap-6 items-start">

        {/* Left: strategy grid */}
        <div className="flex-1 min-w-0">
          <AnimatePresence mode="popLayout">
            <div className="grid sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3">
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

        {/* Right: detail panel — sticky */}
        <div
          className="w-80 shrink-0 sticky top-20 rounded-xl p-7"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--line)',
            minHeight: 420,
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
