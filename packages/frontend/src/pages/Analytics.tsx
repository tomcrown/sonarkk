import { BarChart2, TrendingUp, Activity, AlertTriangle, type LucideIcon } from 'lucide-react'
import { motion } from 'framer-motion'
import { useMarketContext } from '@/hooks/useMarketContext'
import { useSviSurface } from '@/hooks/useSviSurface'
import { VolSurface } from '@/components/vol/VolSurface'
import { StatCard } from '@/components/common/StatCard'
import { BracketCard } from '@/components/common/BracketCard'
import { Skeleton } from '@/components/ui/skeleton'
import { formatVol, formatDateTime } from '@/lib/format'

const REGIME_ROWS = [
  { label: 'PLP Supplier', id: 0, calm: 'Very High', med: 'High', high: 'High', note: 'Spread ↑ with vol' },
  { label: 'Hedged PLP', id: 1, calm: 'High', med: 'Very High', high: 'High', note: 'Hedge offsets delta' },
  { label: 'Smart Vault', id: 2, calm: 'High', med: 'High', high: 'High', note: 'Auto-allocates' },
  { label: 'Principal Protected', id: 3, calm: 'Medium', med: 'Medium', high: 'Medium', note: 'Yield-based' },
  { label: 'Range Roll', id: 4, calm: 'High', med: 'Negative', high: 'Very Negative', note: 'Short-vol view' },
  { label: 'Vol-Targeted Range', id: 5, calm: 'Med', med: 'Negative', high: 'Negative', note: 'Vol cap reduces tail' },
  { label: 'Vol Arb (Sell)', id: 6, calm: 'Med', med: 'Depends', high: 'Negative', note: 'Needs spread to capture' },
]

function RegimeBadge({ value }: { value: string }) {
  const color = value.includes('Very High')
    ? 'text-[#3DD68C] bg-[rgba(34,197,94,0.1)]'
    : value.includes('High')
    ? 'text-[#86efac] bg-[rgba(134,239,172,0.08)]'
    : value.includes('Medium') || value === 'Med' || value === 'Depends'
    ? 'text-[#fbbf24] bg-[rgba(251,191,36,0.08)]'
    : 'text-[#F47C72] bg-[rgba(248,113,113,0.08)]'

  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${color}`}>
      {value}
    </span>
  )
}

export default function Analytics() {
  const { data: ctx, isLoading: ctxLoading } = useMarketContext()
  const { data: surfaceResp, isLoading: surfaceLoading } = useSviSurface()

  const market = ctx?.market
  const atmVol = market?.latestAtmVol
  const oracleHealthy = market != null && market.activeOracleCount > 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">Analytics</p>
        <h1 className="text-2xl font-semibold text-white">Market Analytics</h1>
        <p className="text-sm text-[#9191A4] mt-1">
          Live vol surface, oracle health, and cross-regime performance analysis.
        </p>
      </div>

      {/* Live stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        {ctxLoading ? (
          [1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)
        ) : (
          <>
            <StatCard
              label="ATM Implied Vol"
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
              label="Oracle Status"
              value={oracleHealthy ? 'Healthy' : 'Degraded'}
              subtitle={oracleHealthy ? `${market?.activeOracleCount ?? 0} oracles active` : 'Check predict-server'}
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

      {/* Oracle health note */}
      {market != null && !oracleHealthy && (
        <div className="rounded-lg border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-4 py-3 flex items-start gap-2 text-sm text-[#fbbf24]">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>Oracle calibration service may be degraded. Keeper will apply per-strategy vol thresholds and skip expiries with bad calibration.</span>
        </div>
      )}

      {/* Vol Surface */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#A9A8EC] mb-1">SVI Surface</p>
            <h2 className="text-sm font-semibold text-white">Implied Vol Heatmap</h2>
          </div>
          <p className="text-xs text-[#58586A]">Strike × Expiry grid — darker = higher vol</p>
        </div>

        <BracketCard className="p-5">
          {surfaceLoading ? (
            <Skeleton className="h-52" />
          ) : surfaceResp?.surface && surfaceResp.surface.length > 0 ? (
            <VolSurface surface={surfaceResp.surface} />
          ) : (
            <div className="h-52 flex items-center justify-center text-sm text-[#58586A]">
              No SVI surface data available. Check predict-server connection.
            </div>
          )}
        </BracketCard>
      </div>

      {/* Regime analysis table */}
      <div>
        <div className="mb-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#A9A8EC] mb-1">Regime Analysis</p>
          <h2 className="text-sm font-semibold text-white">Expected performance by vol regime</h2>
          <p className="text-xs text-[#58586A] mt-1">
            Based on Phase 1 backtest analysis. Backtest ran on synthetic trader flow — treat numbers as structural indicators, not guaranteed returns.
          </p>
        </div>

        <div className="bg-[#1C1C21] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden">
          <div className="grid grid-cols-[1.5fr_1fr_1fr_1fr_2fr] gap-4 px-5 py-3 border-b border-[rgba(255,255,255,0.06)] text-[10px] uppercase tracking-wider text-[#58586A]">
            <span>Strategy</span>
            <span>Calm (&lt;25%)</span>
            <span>Medium (25–50%)</span>
            <span>High (&gt;50%)</span>
            <span>Notes</span>
          </div>

          <div className="divide-y divide-[rgba(255,255,255,0.04)]">
            {REGIME_ROWS.map((row, i) => (
              <motion.div
                key={row.id}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.04 }}
                className="grid grid-cols-[1.5fr_1fr_1fr_1fr_2fr] gap-4 px-5 py-3.5 items-center"
              >
                <span className="text-sm font-medium text-white">{row.label}</span>
                <RegimeBadge value={row.calm} />
                <RegimeBadge value={row.med} />
                <RegimeBadge value={row.high} />
                <span className="text-xs text-[#58586A]">{row.note}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <p className="text-xs text-[#58586A] mt-3 italic">
          Disclaimer: Phase 1 data used synthetic volume (/trades endpoint was empty on testnet). Performance reflects structural spread mechanics, not observed fill rates.
        </p>
      </div>
    </div>
  )
}
