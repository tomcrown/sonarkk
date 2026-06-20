/**
 * Vol Regime Stress Chart
 *
 * Shows how each analyzed strategy's APY changes as realized BTC vol rises
 * from 27.7% (observed testnet calm) to 40% / 60% / 80%.
 *
 * House strategies (PLP, PLP-hedged) hold or improve at high vol.
 * Bettor strategies (Range-Roll, Vol-Targeted, Vol-Arb) collapse.
 * This divergence is the central risk argument for house vs bettor.
 */
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'
import { type VolStressRow } from '@/lib/api'

interface VolStressChartProps {
  rows: VolStressRow[]
  breakEvenVolPct: number | null
  strategyClass: 'house' | 'bettor'
}

// Stable color assignment per strategy label
const STRATEGY_COLORS: Record<string, string> = {
  '① PLP Supplier':   '#3DD68C',
  '⑤ Range-Roll':     '#F04438',
  '⑥ Vol-Targeted':   '#E8A627',
  '⑦ Vol-Arb':        '#A9A8EC',
}

function getColor(strategy: string): string {
  return STRATEGY_COLORS[strategy] ?? '#9191A4'
}

export function VolStressChart({ rows, breakEvenVolPct, strategyClass }: VolStressChartProps) {
  if (!rows || rows.length === 0) {
    return <p className="text-sm text-[#58586A]">Stress test data unavailable.</p>
  }

  // Build: { sigmaPct, [strategy]: netApyPct, ... }[]
  const sigmas = [...new Set(rows.map((r) => r.sigmaPct))].sort((a, b) => a - b)
  const strategies = [...new Set(rows.map((r) => r.strategy))]

  const chartData = sigmas.map((sigma) => {
    const point: Record<string, number | string> = { sigmaPct: sigma }
    for (const strat of strategies) {
      const row = rows.find((r) => r.sigmaPct === sigma && r.strategy === strat)
      if (row) point[strat] = row.netApyPct
    }
    return point
  })

  const allApys = rows.map((r) => r.netApyPct)
  const minApy  = Math.min(...allApys)
  const maxApy  = Math.max(...allApys)
  const yMin    = Math.min(minApy * (minApy < 0 ? 1.15 : 0.85), -5)
  const yMax    = Math.max(maxApy * (maxApy > 0 ? 1.15 : 0.85),  5)

  return (
    <div className="space-y-3">
      <div className="text-xs text-[#58586A] leading-relaxed">
        Analytical stress test: SVI pricing stays fixed at real oracle params; only the settlement
        distribution changes. House strategies benefit from higher vol (wider spread);
        bettor strategies collapse when realized vol exceeds implied.
        {breakEvenVolPct != null && strategyClass === 'bettor' && (
          <span className="text-[#E8A627] ml-1">
            Break-even realized vol for selected strategy: <strong>{breakEvenVolPct}%</strong>.
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis
            dataKey="sigmaPct"
            tickFormatter={(v) => `${v}%`}
            tick={{ fontSize: 10, fill: '#58586A' }}
            axisLine={false}
            tickLine={false}
            label={{ value: 'Realized BTC Vol (annualized)', position: 'insideBottom', offset: -2, fontSize: 10, fill: '#58586A' }}
          />
          <YAxis
            tick={{ fontSize: 10, fill: '#58586A' }}
            axisLine={false}
            tickLine={false}
            width={58}
            tickFormatter={(v: number) => `${v.toFixed(0)}%`}
            domain={[yMin, yMax]}
          />
          <Tooltip
            contentStyle={{
              background: '#1A1A22',
              border: '1px solid rgba(169,168,236,0.25)',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#fff',
            }}
            labelFormatter={(v) => `Realized vol: ${v}%`}
            formatter={(v: number, name: string) => [`${v.toFixed(1)}% APY`, name]}
          />
          <Legend
            wrapperStyle={{ fontSize: '11px', paddingTop: '12px' }}
            formatter={(value) => (
              <span style={{ color: getColor(value) }}>{value}</span>
            )}
          />
          {/* Zero-APY reference */}
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.2)" strokeDasharray="4 4" />
          {/* Break-even vol line for bettor strategies */}
          {breakEvenVolPct != null && strategyClass === 'bettor' && (
            <ReferenceLine
              x={breakEvenVolPct}
              stroke="#E8A627"
              strokeDasharray="6 3"
              label={{ value: `B/E ${breakEvenVolPct}%`, position: 'insideTopRight', fontSize: 10, fill: '#E8A627' }}
            />
          )}
          {strategies.map((strat) => (
            <Line
              key={strat}
              type="monotone"
              dataKey={strat}
              stroke={getColor(strat)}
              strokeWidth={2}
              dot={{ r: 4, fill: getColor(strat), stroke: '#1A1A22', strokeWidth: 1.5 }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}
