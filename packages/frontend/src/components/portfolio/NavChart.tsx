import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { formatDate } from '@/lib/format'

interface NavChartProps {
  data: Array<{ date: string; value: number }>
  height?: number
}

export function NavChart({ data, height = 200 }: NavChartProps) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[#58586A] text-sm">
        No performance data yet
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="navGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#A9A8EC" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#A9A8EC" stopOpacity={0} />
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
          width={40}
          tickFormatter={(v: number) => v.toFixed(2)}
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
          formatter={(v: number) => [v.toFixed(4), 'NAV/Share']}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#A9A8EC"
          strokeWidth={2}
          fill="url(#navGradient)"
          dot={false}
          activeDot={{ r: 4, fill: '#A9A8EC', stroke: '#fff', strokeWidth: 1.5 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
