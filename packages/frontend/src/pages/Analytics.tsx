import { useState } from 'react'
import { BarChart2, TrendingUp, Activity, AlertTriangle, ChevronDown, type LucideIcon } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMarketContext } from '@/hooks/useMarketContext'
import { useSviSurface } from '@/hooks/useSviSurface'
import { VolSurface } from '@/components/vol/VolSurface'
import { StatCard } from '@/components/common/StatCard'
import { BracketCard } from '@/components/common/BracketCard'
import { Skeleton } from '@/components/ui/skeleton'
import { formatVol, formatDateTime } from '@/lib/format'

type Regime = 'calm' | 'normal' | 'high'

function getRegimeDisplay(regime: string | undefined, atmVol: number | undefined) {
  const r = (regime ?? 'normal') as Regime
  const map: Record<Regime, { badge: string; color: string; bg: string; border: string; headline: string; detail: string }> = {
    calm: {
      badge: 'CALM',
      color: '#3DD68C',
      bg: 'rgba(61,214,140,0.07)',
      border: 'rgba(61,214,140,0.2)',
      headline: 'Market is calm',
      detail: `Implied vol at ${atmVol ? formatVol(atmVol) : '—'} — below historical average. House strategies are collecting spread efficiently. Short-vol strategies are in their preferred window.`,
    },
    normal: {
      badge: 'ACTIVE',
      color: '#A9A8EC',
      bg: 'rgba(169,168,236,0.07)',
      border: 'rgba(169,168,236,0.2)',
      headline: 'Normal volatility',
      detail: `Implied vol at ${atmVol ? formatVol(atmVol) : '—'}. House strategies operating well — spread income is elevated relative to calm periods. Short-vol strategies carry moderate risk.`,
    },
    high: {
      badge: 'VOLATILE',
      color: '#F04438',
      bg: 'rgba(240,68,56,0.07)',
      border: 'rgba(240,68,56,0.2)',
      headline: 'Elevated volatility',
      detail: `Implied vol at ${atmVol ? formatVol(atmVol) : '—'} — above normal range. House strategies benefit from higher spread income. Short-vol (Range Roll, Vol-Targeted) positions are under pressure — losses are likely.`,
    },
  }
  return map[r] ?? map.normal
}

const REGIME_ROWS = [
  { label: 'PLP Supplier',          id: 0, calm: 'Very High', med: 'High',     high: 'High',         note: 'Spread rises with vol'       },
  { label: 'Hedged PLP',            id: 1, calm: 'High',      med: 'Very High', high: 'High',         note: 'Hedge offsets delta'         },
  { label: 'Smart Vault',           id: 2, calm: 'High',      med: 'High',     high: 'High',         note: 'Auto-allocates'              },
  { label: 'Principal Protected',   id: 3, calm: 'Medium',    med: 'Medium',   high: 'Medium',       note: 'Yield-based; vol-independent' },
  { label: 'Range Roll',            id: 4, calm: 'High',      med: 'Negative', high: 'Very Negative', note: 'Short-vol view — avoid high vol' },
  { label: 'Vol-Targeted Range',    id: 5, calm: 'Medium',    med: 'Negative', high: 'Negative',     note: 'Vol sizing reduces tail loss' },
  { label: 'Vol Arb (Sell)',        id: 6, calm: 'Medium',    med: 'Depends',  high: 'Negative',     note: 'Needs spread to capture'     },
]

function RegimeBadge({ value }: { value: string }) {
  const isVeryHigh = value === 'Very High'
  const isHigh     = value === 'High'
  const isMed      = value === 'Medium' || value === 'Med' || value === 'Depends'
  const isNeg      = value.includes('Negative')
  const color = isVeryHigh ? '#3DD68C' : isHigh ? '#86efac' : isMed ? '#fbbf24' : '#F47C72'
  const bg    = isVeryHigh ? 'rgba(34,197,94,0.1)' : isHigh ? 'rgba(134,239,172,0.08)' : isMed ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)'
  return (
    <span className="inline-block rounded px-2 py-0.5 text-xs font-medium" style={{ color, background: bg }}>
      {isNeg && '↓ '}{value}
    </span>
  )
}

export default function Analytics() {
  const { data: ctx, isLoading: ctxLoading } = useMarketContext()
  const { data: surfaceResp, isLoading: surfaceLoading } = useSviSurface()
  const [techExpanded, setTechExpanded] = useState(false)

  const market        = ctx?.market
  const atmVol        = market?.latestAtmVol
  const oracleHealthy = market != null && market.activeOracleCount > 0
  const regime        = getRegimeDisplay(market?.volRegime, atmVol ?? undefined)

  return (
    <div className="px-10 py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">INTELLIGENCE</div>
      <h1 className="text-6xl md:text-7xl font-display font-medium tracking-tight uppercase mb-12">Market Intel</h1>

      {/* Regime hero */}
      {ctxLoading ? (
        <Skeleton className="h-36 rounded-xl mb-10" />
      ) : (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl p-7 flex items-start justify-between gap-8 mb-10"
          style={{ background: regime.bg, border: `1px solid ${regime.border}` }}
        >
          <div className="flex-1">
            <div className="text-[10px] tracking-[0.15em] mb-3" style={{ color: regime.color }}>
              CURRENT CONDITIONS
            </div>
            <h2 className="text-3xl font-display mb-4 text-foreground">{regime.headline}</h2>
            <p className="text-sm leading-relaxed text-muted-foreground max-w-xl">{regime.detail}</p>
          </div>
          <div className="shrink-0">
            <span
              className="block text-xs font-black uppercase tracking-widest px-4 py-2 rounded-full"
              style={{ background: `${regime.color}1a`, color: regime.color, border: `1px solid ${regime.color}33` }}
            >
              {regime.badge}
            </span>
          </div>
        </motion.div>
      )}

      {/* Oracle health warning */}
      {market != null && !oracleHealthy && (
        <div className="rounded-lg px-4 py-3 flex items-start gap-2 text-sm mb-10 border border-warning/25 bg-warning/5 text-warning">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Oracle calibration may be degraded. Keeper applies per-strategy vol thresholds and skips expiries with bad calibration.
          </span>
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-16">
        {ctxLoading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              label="Implied Vol"
              value={atmVol != null ? formatVol(atmVol) : '—'}
              subtitle={atmVol != null ? (atmVol < 0.18 ? 'Below hedge threshold' : 'Calibration OK') : 'No active oracle'}
              icon={Activity as LucideIcon}
              trend={atmVol != null && atmVol >= 0.18 ? 'up' : 'neutral'}
            />
            <StatCard
              label="Active Oracles"
              value={market?.activeOracleCount != null ? String(market.activeOracleCount) : '—'}
              subtitle="Live calibrated expiries"
              icon={BarChart2 as LucideIcon}
            />
            <StatCard
              label="Oracle Health"
              value={oracleHealthy ? 'Healthy' : 'Degraded'}
              subtitle={oracleHealthy ? `${market?.activeOracleCount ?? 0} active` : 'Check predict-server'}
              icon={TrendingUp as LucideIcon}
              trend={oracleHealthy ? 'up' : 'down'}
            />
            <StatCard
              label="Vol Regime"
              value={market?.volRegime ? market.volRegime.charAt(0).toUpperCase() + market.volRegime.slice(1) : '—'}
              subtitle={market?.timestamp ? `Updated ${formatDateTime(market.timestamp)}` : 'Market context'}
              icon={Activity as LucideIcon}
            />
          </>
        )}
      </div>

      {/* Technical section (expandable) */}
      <div>
        <button
          onClick={() => setTechExpanded((v) => !v)}
          className="flex items-center gap-2 mb-6 group"
        >
          <div className="text-[10px] tracking-[0.15em] text-accent">TECHNICAL DETAILS</div>
          <motion.div animate={{ rotate: techExpanded ? 180 : 0 }} transition={{ duration: 0.15 }}>
            <ChevronDown className="w-3 h-3 text-accent" />
          </motion.div>
          <span className="text-[10px] text-text-dim">
            {techExpanded ? 'Hide' : 'Show SVI surface + regime table'}
          </span>
        </button>

        <AnimatePresence>
          {techExpanded && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
              className="overflow-hidden space-y-8"
            >
              {/* SVI Surface */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <div className="text-[10px] tracking-[0.15em] text-accent mb-1">SVI SURFACE</div>
                    <h3 className="text-sm font-semibold text-foreground">Implied Vol Heatmap</h3>
                  </div>
                  <p className="text-xs text-text-dim">Strike × Expiry — darker = higher vol</p>
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

              {/* Regime table */}
              <div>
                <div className="mb-4">
                  <div className="text-[10px] tracking-[0.15em] text-accent mb-1">REGIME ANALYSIS</div>
                  <h3 className="text-sm font-semibold text-foreground">Expected performance by vol regime</h3>
                  <p className="text-xs mt-1 text-text-dim">
                    Based on Phase 1 backtest. Synthetic trader flow — treat as structural indicators, not guaranteed returns.
                  </p>
                </div>

                <div className="rounded-xl overflow-hidden bg-card border border-border">
                  <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_2fr] gap-4 px-5 py-3 border-b border-border text-[10px] uppercase tracking-wider text-text-dim">
                    <span>Strategy</span>
                    <span>Calm days</span>
                    <span>Normal periods</span>
                    <span>Volatile spikes</span>
                    <span>Key insight</span>
                  </div>
                  <div className="divide-y divide-border/50">
                    {REGIME_ROWS.map((row, i) => (
                      <motion.div
                        key={row.id}
                        initial={{ opacity: 0, x: -6 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.04 }}
                        className="grid grid-cols-[1.5fr_1fr_1fr_1fr_2fr] gap-4 px-5 py-3.5 items-center"
                      >
                        <span className="text-sm font-medium text-foreground">{row.label}</span>
                        <RegimeBadge value={row.calm} />
                        <RegimeBadge value={row.med} />
                        <RegimeBadge value={row.high} />
                        <span className="text-xs text-text-dim">{row.note}</span>
                      </motion.div>
                    ))}
                  </div>
                </div>

                <p className="text-xs mt-3 italic text-text-dim">
                  Data used synthetic volume — /trades endpoint was empty on testnet. Numbers reflect spread mechanics on assumed volume.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  )
}
