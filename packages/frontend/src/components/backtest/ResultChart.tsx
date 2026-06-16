import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import { formatDate } from '@/lib/format'

interface ResultChartProps {
  data: Array<{ date: string; value: number }>
  initialCapital: number
}

export function ResultChart({ data, initialCapital }: ResultChartProps) {
  const min = Math.min(...data.map((d) => d.value))
  const isProfit = (data.at(-1)?.value ?? 0) >= initialCapital

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="backtestGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={isProfit ? '#3DD68C' : '#F04438'} stopOpacity={0.2} />
            <stop offset="95%" stopColor={isProfit ? '#3DD68C' : '#F04438'} stopOpacity={0} />
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
          width={52}
          tickFormatter={(v: number) => `$${v.toLocaleString()}`}
          domain={[Math.min(min * 0.95, initialCapital * 0.95), 'auto']}
        />
        <Tooltip
          contentStyle={{
            background: '#242429',
            border: '1px solid rgba(169,168,236,0.3)',
            borderRadius: '8px',
            fontSize: '12px',
            color: '#fff',
          }}
          labelFormatter={(v) => formatDate(String(v))}
          formatter={(v: number) => [`$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, 'Portfolio']}
        />
        <ReferenceLine
          y={initialCapital}
          stroke="rgba(255,255,255,0.2)"
          strokeDasharray="4 4"
          label={{ value: 'Initial', position: 'insideTopRight', fontSize: 10, fill: '#58586A' }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke={isProfit ? '#3DD68C' : '#F04438'}
          strokeWidth={2}
          fill="url(#backtestGradient)"
          dot={false}
          activeDot={{ r: 4, fill: isProfit ? '#3DD68C' : '#F04438', stroke: '#fff', strokeWidth: 1.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
