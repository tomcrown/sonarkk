import { useState } from 'react'
import {
  CheckCircle2, AlertTriangle, XCircle, ChevronDown, TrendingUp,
  Bitcoin, Layers, Percent, Clock,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMarketContext } from '@/hooks/useMarketContext'
import { useSviSurface } from '@/hooks/useSviSurface'
import { VolSurface } from '@/components/vol/VolSurface'
import { BracketCard } from '@/components/common/BracketCard'
import { Skeleton } from '@/components/ui/skeleton'
import { formatVol, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/cn'

// ── Types ──────────────────────────────────────────────────────────────────────

type Regime = 'calm' | 'normal' | 'high'
type Signal = 'favorable' | 'caution' | 'avoid'

interface StrategySignal {
  name: string
  signal: Signal
  reason: string
  type: 'house' | 'bettor'
}

// ── Static data ────────────────────────────────────────────────────────────────

const REGIME_META: Record<Regime, {
  label: string; badge: string
  color: string; bg: string; border: string
  headline: string; detail: string
}> = {
  calm: {
    label: 'Calm', badge: 'CALM',
    color: '#3DD68C', bg: 'rgba(61,214,140,0.07)', border: 'rgba(61,214,140,0.18)',
    headline: 'Market is calm',
    detail: 'Implied volatility is below average. The spread bettors pay is near its floor — optimal entry for short-vol strategies. House strategies are collecting spread efficiently across all cycles.',
  },
  normal: {
    label: 'Active', badge: 'ACTIVE',
    color: '#A9A8EC', bg: 'rgba(169,168,236,0.07)', border: 'rgba(169,168,236,0.2)',
    headline: 'Normal volatility',
    detail: 'Implied volatility is within its historical range. House strategies are operating well — spread income is solid. Short-vol positions are viable but carry moderate risk if vol spikes.',
  },
  high: {
    label: 'Elevated', badge: 'ELEVATED',
    color: '#F04438', bg: 'rgba(240,68,56,0.07)', border: 'rgba(240,68,56,0.18)',
    headline: 'Elevated volatility',
    detail: 'Implied volatility is above normal range. House strategies benefit from higher spread income on every bet placed. Short-vol strategies (Range Roll, Vol-Targeted) are under pressure — losses are likely. Do not add to those positions now.',
  },
}

const REGIME_TABLE = [
  { label: 'PLP Supplier',        calm: 'Very High', normal: 'High',     high: 'High',          note: 'Spread rises with vol — house always benefits'      },
  { label: 'Hedged PLP',          calm: 'High',      normal: 'Very High', high: 'High',          note: 'Spot hedge offsets directional exposure each cycle' },
  { label: 'Smart Vault',         calm: 'High',      normal: 'High',     high: 'High',          note: 'Auto-allocates across house strategies'             },
  { label: 'Principal Protected', calm: 'Medium',    normal: 'Medium',   high: 'Medium',        note: 'Yield-based — vol does not affect principal'        },
  { label: 'Range Roll',          calm: 'High',      normal: 'Negative', high: 'Very Negative', note: 'Short-vol view — avoid during elevated vol'         },
  { label: 'Vol-Targeted Range',  calm: 'Medium',    normal: 'Negative', high: 'Negative',      note: 'Vol-sizing reduces tail loss vs Range Roll'         },
  { label: 'Vol Arb (Sell)',      calm: 'Low',       normal: 'Depends',  high: 'Negative',      note: 'Needs cross-venue spread to capture edge'           },
]

// ── Helpers ────────────────────────────────────────────────────────────────────

function getStrategySignals(regime: Regime): StrategySignal[] {
  return [
    {
      name: 'PLP Supplier', type: 'house', signal: 'favorable',
      reason: regime === 'calm'
        ? 'Spread income active — collecting on every bet placed'
        : regime === 'normal'
        ? 'Spread elevated above calm baseline — solid conditions'
        : 'High spread income — best conditions for house strategies',
    },
    {
      name: 'Hedged PLP', type: 'house', signal: 'favorable',
      reason: regime === 'calm'
        ? 'Spread income active, hedge cost is minimal'
        : regime === 'normal'
        ? 'Spread elevated, Spot hedge offsetting delta exposure'
        : 'High spread income with hedge working as intended',
    },
    {
      name: 'Smart Vault', type: 'house', signal: 'favorable',
      reason: 'Auto-allocates across house strategies — regime-robust by design',
    },
    {
      name: 'Principal Protected', type: 'house', signal: 'favorable',
      reason: 'Yield-based — principal never enters the options pool, vol-independent',
    },
    {
      name: 'Range Roll', type: 'bettor',
      signal: regime === 'calm' ? 'favorable' : regime === 'normal' ? 'caution' : 'avoid',
      reason: regime === 'calm'
        ? 'Short-vol strategy in its preferred window — low implied vol'
        : regime === 'normal'
        ? 'Spread cost rising — approaching unfavorable territory'
        : 'Avoid — short-vol strategies lose in elevated volatility',
    },
    {
      name: 'Vol-Targeted Range', type: 'bettor',
      signal: regime === 'calm' ? 'favorable' : 'caution',
      reason: regime === 'calm'
        ? 'Preferred window — vol-sizing keeps position size appropriate'
        : regime === 'normal'
        ? 'Vol-sizing reduces exposure — manageable but watch closely'
        : 'Vol cap limits losses, but still under pressure in this regime',
    },
    {
      name: 'Vol Arb (Sell)', type: 'bettor',
      signal: regime === 'calm' ? 'caution' : regime === 'normal' ? 'caution' : 'avoid',
      reason: regime === 'calm'
        ? 'Spread is near floor at low vol — limited edge to capture'
        : regime === 'normal'
        ? 'Moderate edge — depends on cross-venue pricing differential'
        : 'Avoid — spread compression in elevated vol hurts execution',
    },
  ]
}

function regimeScore(value: string): number {
  if (value === 'Very High') return 4
  if (value === 'High')      return 3
  if (value === 'Medium' || value === 'Low' || value === 'Depends') return 2
  if (value === 'Negative')  return 1
  return 0
}

// ── Small components ───────────────────────────────────────────────────────────

function RegimeBadge({ value }: { value: string }) {
  const score = regimeScore(value)
  const styles =
    score >= 4 ? { color: '#3DD68C', bg: 'rgba(61,214,140,0.1)' } :
    score === 3 ? { color: '#86efac', bg: 'rgba(134,239,172,0.08)' } :
    score === 2 ? { color: '#E8A627', bg: 'rgba(232,166,39,0.08)' } :
    { color: '#F47C72', bg: 'rgba(248,113,113,0.08)' }
  const isNeg = value.includes('Negative')
  return (
    <span
      className="inline-block rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap"
      style={{ color: styles.color, background: styles.bg }}
    >
      {isNeg && '↓ '}{value}
    </span>
  )
}

function SignalIcon({ signal }: { signal: Signal }) {
  if (signal === 'favorable') return <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
  if (signal === 'caution')   return <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
  return <XCircle className="w-4 h-4 text-danger shrink-0" />
}

function SignalBadge({ signal }: { signal: Signal }) {
  const map = {
    favorable: { label: 'Favorable', cls: 'text-success bg-success/10 border-success/20' },
    caution:   { label: 'Caution',   cls: 'text-warning bg-warning/10 border-warning/20' },
    avoid:     { label: 'Avoid',     cls: 'text-danger  bg-danger/10  border-danger/20'  },
  }
  const { label, cls } = map[signal]
  return (
    <span className={cn('text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border', cls)}>
      {label}
    </span>
  )
}

function ContextCard({
  label, value, sub, icon: Icon, loading, accent,
}: {
  label: string; value: React.ReactNode; sub?: string
  icon?: React.ElementType; loading?: boolean; accent?: string
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-6 hover:border-accent/30 transition-colors">
      <div className="text-[10px] tracking-[0.15em] text-text-dim mb-4 flex items-center justify-between">
        <span>{label}</span>
        {Icon && <Icon className="w-3.5 h-3.5 text-text-dim opacity-60" />}
      </div>
      {loading ? (
        <Skeleton className="h-10 w-28 mb-3" />
      ) : (
        <div
          className="text-2xl md:text-3xl font-display font-medium tracking-tight"
          style={accent ? { color: accent } : {}}
        >
          {value}
        </div>
      )}
      {sub && <div className="mt-3 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { data: ctx, isLoading: ctxLoading } = useMarketContext()
  const { data: surfaceResp, isLoading: surfaceLoading } = useSviSurface()
  const [tradersExpanded, setTradersExpanded] = useState(false)

  const market      = ctx?.market
  const regime      = (market?.volRegime ?? 'normal') as Regime
  const regimeMeta  = REGIME_META[regime]
  const atmVol      = market?.latestAtmVol
  const btcPrice    = market?.btcPriceUsd
  const spreadAtAtm = market?.spreadAtAtm
  const expiryMin   = market?.expiryInMinutes
  const oracleOk    = (market?.activeOracleCount ?? 0) > 0

  const signals     = getStrategySignals(regime)
  const houseSignals  = signals.filter((s) => s.type === 'house')
  const bettorSignals = signals.filter((s) => s.type === 'bettor')

  // Active regime column highlight in table
  const activeCol: Record<Regime, 'calm' | 'normal' | 'high'> = {
    calm: 'calm', normal: 'normal', high: 'high',
  }
  const activeRegimeCol = activeCol[regime]

  return (
    <div className="px-10 py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">INTELLIGENCE</div>
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight uppercase mb-10">
        Market Intel
      </h1>

      {/* ── Regime hero ────────────────────────────────────────────────────── */}
      {ctxLoading ? (
        <Skeleton className="h-40 rounded-xl mb-10" />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-8 mb-10 flex items-start justify-between gap-8"
          style={{ background: regimeMeta.bg, border: `1px solid ${regimeMeta.border}` }}
        >
          <div className="flex-1">
            <div className="text-[10px] tracking-[0.15em] mb-3" style={{ color: regimeMeta.color }}>
              CURRENT CONDITIONS
            </div>
            <h2 className="text-3xl font-display mb-4 text-foreground">{regimeMeta.headline}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground max-w-2xl">{regimeMeta.detail}</p>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-3">
            <span
              className="text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full"
              style={{
                background: `${regimeMeta.color}1a`,
                color: regimeMeta.color,
                border: `1px solid ${regimeMeta.color}33`,
              }}
            >
              {regimeMeta.badge}
            </span>
            {expiryMin != null && expiryMin > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                Next settlement in {Math.round(expiryMin)}m
              </div>
            )}
          </div>
        </motion.div>
      )}

      {/* Oracle health warning */}
      {!ctxLoading && market != null && !oracleOk && (
        <div className="rounded-lg px-4 py-3 flex items-start gap-2 text-sm mb-10 border border-warning/25 bg-warning/5 text-warning">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            No active oracle markets detected. The keeper will pick up automatically when the next expiry activates.
          </span>
        </div>
      )}

      {/* ── Context cards ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-12">
        <ContextCard
          label="MARKET VOLATILITY"
          value={atmVol != null ? formatVol(atmVol) : '—'}
          sub={
            atmVol == null ? 'No active oracle' :
            atmVol < 0.18 ? 'Low — near floor for spread income' :
            atmVol < 0.35 ? 'Normal — spread income is solid' :
            'Elevated — spread is wide, house earns more'
          }
          icon={TrendingUp}
          accent={
            atmVol == null ? undefined :
            atmVol < 0.25 ? '#3DD68C' :
            atmVol < 0.50 ? '#A9A8EC' : '#F04438'
          }
          loading={ctxLoading}
        />
        <ContextCard
          label="BTC PRICE"
          value={
            btcPrice != null
              ? `$${btcPrice.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
              : '—'
          }
          sub="Live price"
          icon={Bitcoin}
          loading={ctxLoading}
        />
        <ContextCard
          label="MARKETS OPEN"
          value={market != null ? String(market.activeOracleCount) : '—'}
          sub={
            expiryMin != null && expiryMin > 0
              ? `Next settlement in ${Math.round(expiryMin)} min`
              : 'Active expiries right now'
          }
          icon={Layers}
          loading={ctxLoading}
        />
        <ContextCard
          label="SPREAD INCOME"
          value={spreadAtAtm != null ? `${(spreadAtAtm * 100).toFixed(2)}%` : '—'}
          sub="House earns this on every ATM bet placed"
          icon={Percent}
          accent="#A9A8EC"
          loading={ctxLoading}
        />
      </div>

      {/* ── Strategy signals ────────────────────────────────────────────────── */}
      <div className="mb-12">
        <div className="text-[10px] tracking-[0.15em] text-text-dim mb-2">STRATEGY SIGNALS</div>
        <div className="flex items-end justify-between mb-8">
          <h2 className="text-2xl font-display">What to run right now</h2>
          <p className="text-xs text-text-dim max-w-xs text-right">
            Based on current market conditions · updates live
          </p>
        </div>

        {ctxLoading ? (
          <div className="grid md:grid-cols-2 gap-3">
            {[1,2,3,4,5,6,7].map((i) => <Skeleton key={i} className="h-20 rounded-xl" />)}
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-6">
            {/* House strategies */}
            <div className="space-y-3">
              <div className="text-[10px] tracking-[0.15em] text-text-dim pb-2 border-b border-border">
                HOUSE STRATEGIES — structural edge
              </div>
              {houseSignals.map((s, i) => (
                <motion.div
                  key={s.name}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 }}
                  className="flex items-start gap-4 bg-card border border-border rounded-xl p-4 hover:border-accent/25 transition-colors"
                >
                  <SignalIcon signal={s.signal} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{s.name}</span>
                      <SignalBadge signal={s.signal} />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{s.reason}</p>
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Bettor strategies */}
            <div className="space-y-3">
              <div className="text-[10px] tracking-[0.15em] text-text-dim pb-2 border-b border-border">
                SHORT-VOL STRATEGIES — regime-sensitive
              </div>
              {bettorSignals.map((s, i) => (
                <motion.div
                  key={s.name}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.06 + 0.2 }}
                  className={cn(
                    'flex items-start gap-4 rounded-xl p-4 border transition-colors',
                    s.signal === 'avoid'
                      ? 'bg-danger/5 border-danger/15 hover:border-danger/25'
                      : s.signal === 'caution'
                      ? 'bg-warning/5 border-warning/15 hover:border-warning/25'
                      : 'bg-card border-border hover:border-accent/25'
                  )}
                >
                  <SignalIcon signal={s.signal} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-foreground">{s.name}</span>
                      <SignalBadge signal={s.signal} />
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{s.reason}</p>
                  </div>
                </motion.div>
              ))}
              <div className="rounded-xl p-4 border border-border/50 bg-card/50">
                <p className="text-[10px] text-text-dim leading-relaxed">
                  Short-vol strategies are profitable in calm markets and lose in volatility spikes. Check current conditions before deploying.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── Regime table ────────────────────────────────────────────────────── */}
      <div className="mb-12">
        <div className="text-[10px] tracking-[0.15em] text-text-dim mb-2">REGIME ANALYSIS</div>
        <div className="flex items-end justify-between mb-6">
          <h2 className="text-2xl font-display">When each strategy works</h2>
          <p className="text-xs text-text-dim">
            Based on Phase 1 backtest · synthetic trader flow
          </p>
        </div>

        <div className="rounded-xl overflow-hidden bg-card border border-border">
          <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_2fr] gap-4 px-5 py-3 border-b border-border">
            <span className="text-[10px] uppercase tracking-wider text-text-dim">Strategy</span>
            {(['calm', 'normal', 'high'] as Regime[]).map((r) => (
              <span
                key={r}
                className={cn(
                  'text-[10px] uppercase tracking-wider text-center',
                  activeRegimeCol === r ? 'font-bold' : 'text-text-dim'
                )}
                style={activeRegimeCol === r ? { color: REGIME_META[r].color } : {}}
              >
                {REGIME_META[r].label}
                {activeRegimeCol === r && ' ←'}
              </span>
            ))}
            <span className="text-[10px] uppercase tracking-wider text-text-dim">Key insight</span>
          </div>
          <div className="divide-y divide-border/50">
            {REGIME_TABLE.map((row, i) => (
              <motion.div
                key={row.label}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="grid grid-cols-[1.6fr_1fr_1fr_1fr_2fr] gap-4 px-5 py-3.5 items-center hover:bg-surface-2/40 transition-colors"
              >
                <span className="text-sm font-medium text-foreground">{row.label}</span>
                {(['calm', 'normal', 'high'] as Regime[]).map((r) => {
                  const val = row[r]
                  return (
                    <div
                      key={r}
                      className={cn(
                        'flex justify-center transition-all',
                        activeRegimeCol === r && 'scale-105'
                      )}
                    >
                      <RegimeBadge value={val} />
                    </div>
                  )
                })}
                <span className="text-xs text-text-dim">{row.note}</span>
              </motion.div>
            ))}
          </div>
        </div>
        <p className="text-xs mt-3 text-text-dim italic">
          Synthetic volume — /trades endpoint empty on testnet. Treat as structural indicators, not guaranteed returns.
        </p>
      </div>

      {/* ── For traders (collapsible) ───────────────────────────────────────── */}
      <div>
        <button
          onClick={() => setTradersExpanded((v) => !v)}
          className="flex items-center gap-3 mb-1 group w-full"
        >
          <div className="text-[10px] tracking-[0.15em] text-accent">FOR TRADERS</div>
          <motion.div animate={{ rotate: tradersExpanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="w-3.5 h-3.5 text-accent" />
          </motion.div>
          <span className="text-[10px] text-text-dim">
            {tradersExpanded ? 'Hide' : 'Show SVI vol surface + oracle details'}
          </span>
        </button>

        <AnimatePresence>
          {tradersExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden space-y-8 pt-6"
            >
              {/* SVI surface */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[10px] tracking-[0.15em] text-accent mb-1">SVI VOL SURFACE</div>
                    <h3 className="text-sm font-semibold text-foreground">Vol term structure & smile — Active expiries</h3>
                    <p className="text-xs text-text-dim mt-1">
                      Term Structure tab: ATM implied vol and house spread income per oracle, sorted by expiry. Higher ATM vol = wider spread = more income for house strategies.
                      Vol Smile tab: full SVI smile (implied vol vs log-moneyness) for each active expiry — skew and wing structure at a glance.
                    </p>
                  </div>
                  <p className="text-xs text-text-dim shrink-0 ml-4">
                    {market?.timestamp ? `Updated ${formatDateTime(market.timestamp)}` : ''}
                  </p>
                </div>
                <BracketCard className="p-5">
                  {surfaceLoading ? (
                    <Skeleton className="h-52" />
                  ) : surfaceResp?.surface && surfaceResp.surface.length > 0 ? (
                    <VolSurface surface={surfaceResp.surface} />
                  ) : (
                    <div className="h-52 flex items-center justify-center text-sm text-text-dim">
                      No SVI surface data available. Check predict-server connection.
                    </div>
                  )}
                </BracketCard>
              </div>

              {/* Oracle details */}
              <div>
                <div className="text-[10px] tracking-[0.15em] text-accent mb-4">ORACLE STATUS</div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {[
                    {
                      label: 'Active oracles',
                      value: market?.activeOracleCount != null ? String(market.activeOracleCount) : '—',
                    },
                    {
                      label: 'Calibration',
                      value: oracleOk ? 'Healthy' : 'Degraded',
                      accent: oracleOk ? '#3DD68C' : '#F04438',
                    },
                    {
                      label: 'ATM vol (raw)',
                      value: atmVol != null ? `${(atmVol * 100).toFixed(2)}%` : '—',
                    },
                    {
                      label: 'Spread at ATM',
                      value: spreadAtAtm != null ? `${(spreadAtAtm * 100).toFixed(2)}%` : '—',
                    },
                  ].map(({ label, value, accent }) => (
                    <div key={label} className="bg-card border border-border rounded-lg p-4">
                      <div className="text-[10px] tracking-[0.15em] text-text-dim mb-2">{label.toUpperCase()}</div>
                      <div
                        className="text-xl font-display font-medium"
                        style={accent ? { color: accent } : {}}
                      >
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
