/**
 * VolSurface — Term structure table + implied vol smile chart.
 *
 * Two tabs:
 *   Term Structure — ATM vol + spread per expiry (table)
 *   Smile — implied vol vs log-moneyness for each expiry (line chart)
 *
 * Sub-hour option wings are extreme (sqrt(w/T) → ∞ as T → 0), so we cap
 * displayed vol at 500% and note this for the user.
 */
import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { type SviExpiry } from '@/lib/api'
import { formatDateTime, formatVol } from '@/lib/format'
import { Tooltip as UITooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/cn'

interface VolSurfaceProps {
  surface: SviExpiry[]
}

function timeToExpiry(expiryMs: string): string {
  const ms = Number(expiryMs) - Date.now()
  if (ms <= 0) return 'expired'
  const mins = Math.floor(ms / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = (ms / 3_600_000).toFixed(1)
  return `${hours}h`
}

function volRegimeColor(vol: number): string {
  if (vol < 0.25) return '#3DD68C'
  if (vol < 0.50) return '#A9A8EC'
  return '#F04438'
}

function volRegimeLabel(vol: number): string {
  if (vol < 0.25) return 'Calm'
  if (vol < 0.50) return 'Normal'
  return 'High'
}

// Assign distinct colors to expiries (up to 10)
const EXPIRY_COLORS = [
  '#A9A8EC', '#3DD68C', '#E8A627', '#F04438', '#60C8FF',
  '#E47BE3', '#FFBE6A', '#9DF58B', '#FF9877', '#7FC1FF',
]

function buildSmileData(surface: SviExpiry[]) {
  // Collect all k values from the surface
  const kValues = surface.length > 0 ? surface[0]!.strikes.map((s) => s.k) : []

  return kValues.map((k) => {
    const point: Record<string, number> = { k }
    for (const expiry of surface) {
      const strike = expiry.strikes.find((s) => s.k === k)
      if (strike) {
        // Cap at 5 (500%) to prevent extreme sub-hour wings from dominating Y axis
        point[expiry.expiryMs] = Math.min(strike.vol * 100, 500)
      }
    }
    return point
  })
}

export function VolSurface({ surface }: VolSurfaceProps) {
  const [tab, setTab] = useState<'term' | 'smile'>('term')

  if (!surface || surface.length === 0) {
    return <p className="text-sm text-[#58586A]">No surface data available.</p>
  }

  const smileData = buildSmileData(surface)
  const hasWingBlowup = surface.some((e) =>
    e.strikes.some((s) => Math.abs(s.k) > 0.1 && s.vol > 5)
  )

  return (
    <TooltipProvider>
      {/* Tab bar */}
      <div className="flex gap-1 mb-4">
        {(['term', 'smile'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-3 py-1 text-[10px] font-semibold uppercase tracking-wider rounded transition-colors',
              tab === t
                ? 'bg-accent/20 text-accent border border-accent/30'
                : 'text-[#58586A] hover:text-[#9191A4]',
            )}
          >
            {t === 'term' ? 'Term Structure' : 'Vol Smile'}
          </button>
        ))}
      </div>

      {tab === 'term' && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs" aria-label="Vol term structure">
              <thead>
                <tr>
                  <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">Expiry</th>
                  <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">TTX</th>
                  <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">ATM Vol</th>
                  <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">Regime</th>
                  <th className="pb-2 text-left text-[#58586A] font-medium whitespace-nowrap">
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dotted border-[#58586A]">Spread@ATM</span>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>House income per unit notional on an ATM bet.</p>
                        <p className="text-[10px] text-muted-foreground mt-1">Assumes 30% pool utilization.</p>
                      </TooltipContent>
                    </UITooltip>
                  </th>
                </tr>
              </thead>
              <tbody>
                {surface.map((expiry) => {
                  const atmStrike = expiry.strikes.find(s => s.k === 0)
                  const spread = atmStrike?.spread ?? null
                  const color = volRegimeColor(expiry.atmVol)
                  const label = volRegimeLabel(expiry.atmVol)
                  return (
                    <tr
                      key={expiry.expiryMs}
                      className="border-t border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                    >
                      <td className="py-2 pr-4 text-[#9191A4] whitespace-nowrap font-mono">
                        {formatDateTime(Number(expiry.expiryMs))}
                      </td>
                      <td className="py-2 pr-4 text-[#9191A4] whitespace-nowrap font-mono font-semibold">
                        {timeToExpiry(expiry.expiryMs)}
                      </td>
                      <td className="py-2 pr-4 font-semibold" style={{ color }}>
                        {formatVol(expiry.atmVol)}
                      </td>
                      <td className="py-2 pr-4">
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
                        >
                          {label}
                        </span>
                      </td>
                      <td className="py-2">
                        <span className={cn('font-semibold', spread != null && spread > 0.02 ? 'text-[#3DD68C]' : 'text-[#A9A8EC]')}>
                          {spread != null ? `${(spread * 100).toFixed(2)}%` : '—'}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 text-[10px] text-[#58586A] leading-relaxed">
            <span className="font-semibold text-[#9191A4]">How to read: </span>
            ATM vol = how expensive options are. Higher vol = wider spread = more income for house strategies.
            Spread@ATM = what PLP Supplier and Hedged PLP earn per bet at the current BTC price.
          </div>
        </>
      )}

      {tab === 'smile' && (
        <div className="space-y-3">
          {hasWingBlowup && (
            <div className="text-[10px] text-[#E8A627] bg-[rgba(232,166,39,0.08)] border border-[rgba(232,166,39,0.2)] rounded px-3 py-2">
              Sub-hour options have extreme wings (√(w/T) → ∞ as T → 0). Off-ATM vols are capped at 500% for display.
              Only ATM vol is robust for these short expiries.
            </div>
          )}
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={smileData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
              <XAxis
                dataKey="k"
                tickFormatter={(v: number) => v.toFixed(1)}
                tick={{ fontSize: 10, fill: '#58586A' }}
                axisLine={false}
                tickLine={false}
                label={{ value: 'Log-moneyness k = ln(K/F)', position: 'insideBottom', offset: -2, fontSize: 9, fill: '#58586A' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#58586A' }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={(v: number) => `${v.toFixed(0)}%`}
              />
              <Tooltip
                contentStyle={{ background: '#1A1A22', border: '1px solid rgba(169,168,236,0.2)', borderRadius: '6px', fontSize: '10px', color: '#fff' }}
                labelFormatter={(v: number) => `k = ${Number(v).toFixed(2)}`}
                formatter={(v: number, name: string) => [`${Number(v).toFixed(1)}%`, `Exp ${new Date(Number(name)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`]}
              />
              <Legend
                wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
                formatter={(_value, entry) => (
                  <span style={{ color: entry.color }}>
                    {new Date(Number(entry.value)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              />
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)" strokeDasharray="3 3" label={{ value: 'ATM', position: 'insideTopLeft', fontSize: 9, fill: '#58586A' }} />
              {surface.map((expiry, i) => (
                <Line
                  key={expiry.expiryMs}
                  type="monotone"
                  dataKey={expiry.expiryMs}
                  stroke={EXPIRY_COLORS[i % EXPIRY_COLORS.length]}
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
          <p className="text-[10px] text-[#58586A]">
            Each line = one active expiry. Smile shape shows skew (asymmetry) and wings.
            ATM (k=0) vol is the most stable; off-ATM wings are unreliable for sub-hour expiries.
          </p>
        </div>
      )}
    </TooltipProvider>
  )
}
