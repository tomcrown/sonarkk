import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { formatDate } from '@/lib/format'

interface ResultChartProps {
  data: Array<{ date: string; value: number }>
  initialCapital: number
}

export function ResultChart({ data, initialCapital }: ResultChartProps) {
  if (data.length < 2) {
    return (
      <div className="h-48 flex items-center justify-center text-sm text-[#58586A]">
        Insufficient data points to render chart.
      </div>
    )
  }

  const endValue  = data.at(-1)?.value ?? initialCapital
  const minValue  = Math.min(...data.map((d) => d.value))
  const isProfit  = endValue >= initialCapital
  const lineColor = isProfit ? '#3DD68C' : '#F04438'

  // Downsample to ≤400 points for rendering performance while keeping start + end
  const MAX_POINTS = 400
  let plotData = data
  if (data.length > MAX_POINTS) {
    const step = Math.ceil(data.length / MAX_POINTS)
    plotData = data.filter((_, i) => i % step === 0 || i === data.length - 1)
  }

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={plotData} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="backtestGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={lineColor} stopOpacity={0.18} />
            <stop offset="95%" stopColor={lineColor} stopOpacity={0}    />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
        <XAxis
          dataKey="date"
          tickFormatter={(v) => formatDate(v)}
          tick={{ fontSize: 10, fill: '#58586A' }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#58586A' }}
          axisLine={false}
          tickLine={false}
          width={54}
          tickFormatter={(v: number) => `${v.toFixed(0)}`}
          domain={[Math.min(minValue * 0.97, initialCapital * 0.97), 'auto']}
        />
        <Tooltip
          contentStyle={{
            background: '#1A1A22',
            border: '1px solid rgba(169,168,236,0.25)',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#fff',
          }}
          labelFormatter={(v) => formatDate(String(v))}
          formatter={(v: number) => [
            `${v.toFixed(2)} NAV`,
            'Portfolio',
          ]}
        />
        <ReferenceLine
          y={initialCapital}
          stroke="rgba(255,255,255,0.18)"
          strokeDasharray="4 4"
          label={{ value: 'Initial', position: 'insideTopRight', fontSize: 10, fill: '#58586A' }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={lineColor}
          strokeWidth={1.5}
          fill="url(#backtestGradient)"
          dot={false}
          activeDot={{ r: 3, fill: lineColor, stroke: '#fff', strokeWidth: 1.5 }}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
