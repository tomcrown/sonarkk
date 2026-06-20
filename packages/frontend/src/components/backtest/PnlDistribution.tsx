/**
 * Per-round P&L distribution histogram.
 *
 * Shows the empirical distribution of round returns (pnl_fraction × 100%)
 * binned into 20 buckets. Reveals fat tails and skew that aggregate APY hides.
 *
 * House strategies: tight cluster of small positives → consistent spread income.
 * Bettor strategies: bimodal or right-skewed with large negative tail on vol spikes.
 */
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { type RoundPoint } from '@/lib/api'

interface PnlDistributionProps {
  rounds: RoundPoint[]
  strategyClass: 'house' | 'bettor'
}

const NUM_BINS = 24

function buildHistogram(rounds: RoundPoint[]) {
  if (rounds.length === 0) return []

  const pnls = rounds.map((r) => r.pnlFraction * 100) // convert to %
  const min = Math.min(...pnls)
  const max = Math.max(...pnls)

  // Pad range slightly
  const lo = min - Math.abs(min) * 0.05
  const hi = max + Math.abs(max) * 0.05
  const binWidth = (hi - lo) / NUM_BINS

  const bins: { label: string; count: number; midPct: number }[] = Array.from(
    { length: NUM_BINS },
    (_, i) => ({
      label: `${(lo + i * binWidth).toFixed(2)}`,
      midPct: lo + (i + 0.5) * binWidth,
      count: 0,
    }),
  )

  for (const pnl of pnls) {
    const idx = Math.min(Math.floor((pnl - lo) / binWidth), NUM_BINS - 1)
    if (idx >= 0 && idx < NUM_BINS) bins[idx]!.count++
  }

  return bins
}

export function PnlDistribution({ rounds, strategyClass }: PnlDistributionProps) {
  if (!rounds || rounds.length === 0) {
    return <p className="text-sm text-[#58586A]">No round data available.</p>
  }

  const bins = buildHistogram(rounds)
  const positiveRounds = rounds.filter((r) => r.pnlFraction > 0).length
  const winRate = (positiveRounds / rounds.length) * 100
  const avgPnl = rounds.reduce((s, r) => s + r.pnlFraction, 0) / rounds.length * 100
  const maxLoss = Math.min(...rounds.map((r) => r.pnlFraction)) * 100
  const maxGain = Math.max(...rounds.map((r) => r.pnlFraction)) * 100

  return (
    <div className="space-y-4">
      {/* Summary stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Rounds', value: String(rounds.length) },
          { label: 'Win Rate', value: `${winRate.toFixed(1)}%` },
          { label: 'Avg / Round', value: `${avgPnl >= 0 ? '+' : ''}${avgPnl.toFixed(3)}%` },
          { label: 'Worst Round', value: `${maxLoss.toFixed(3)}%` },
        ].map(({ label, value }) => (
          <div key={label} className="bg-[rgba(255,255,255,0.02)] rounded-lg px-3 py-2 border border-[rgba(255,255,255,0.04)]">
            <div className="text-[9px] tracking-widest text-[#58586A] mb-1">{label}</div>
            <div className="text-sm font-mono font-semibold text-[#9191A4]">{value}</div>
          </div>
        ))}
      </div>

      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={bins} margin={{ top: 4, right: 0, bottom: 0, left: 0 }} barCategoryGap={1}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
          <XAxis
            dataKey="midPct"
            tickFormatter={(v: number) => `${v.toFixed(1)}%`}
            tick={{ fontSize: 9, fill: '#58586A' }}
            axisLine={false}
            tickLine={false}
            interval={Math.floor(NUM_BINS / 6)}
          />
          <YAxis
            tick={{ fontSize: 9, fill: '#58586A' }}
            axisLine={false}
            tickLine={false}
            width={28}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              background: '#1A1A22',
              border: '1px solid rgba(169,168,236,0.2)',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#fff',
            }}
            labelFormatter={(v: number) => `≈ ${Number(v).toFixed(3)}% / round`}
            formatter={(v: number) => [`${v} rounds`, 'Count']}
          />
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="3 3" />
          <Bar
            dataKey="count"
            fill={strategyClass === 'house' ? '#3DD68C' : '#F04438'}
            fillOpacity={0.7}
            shape={(props: {
              x?: number; y?: number; width?: number; height?: number;
              midPct?: number; fill?: string; fillOpacity?: number
            }) => {
              const { x = 0, y = 0, width = 0, height = 0, midPct = 0 } = props
              const color = midPct >= 0 ? '#3DD68C' : '#F04438'
              return <rect x={x} y={y} width={width} height={height} fill={color} fillOpacity={0.7} rx={1} />
            }}
            isAnimationActive={false}
          />
        </BarChart>
      </ResponsiveContainer>

      <p className="text-[10px] text-[#58586A]">
        {strategyClass === 'house'
          ? 'House strategies show a tight cluster of small positive returns — consistent spread income each cycle.'
          : 'Bettor strategies show a long left tail — most rounds are small losses offset by occasional wins when price stays in range.'}
        {` Worst single round: ${maxLoss.toFixed(3)}%. Best: +${maxGain.toFixed(3)}%.`}
      </p>
    </div>
  )
}
