import { type RegimeRow } from '@/lib/api'
import { formatPct } from '@/lib/format'

interface RegimeTableProps {
  regimeBreakdown: Record<string, RegimeRow>
}

const REGIME_META: Record<string, { label: string; color: string; bg: string }> = {
  calm:   { label: 'Calm (ATM vol < 25%)',    color: '#3DD68C', bg: 'rgba(61,214,140,0.12)'   },
  normal: { label: 'Normal (25–50%)',          color: '#A9A8EC', bg: 'rgba(169,168,236,0.12)' },
  high:   { label: 'High (vol > 50%)',         color: '#F04438', bg: 'rgba(240,68,56,0.12)'   },
}

function SharpeBar({ value }: { value: number }) {
  const clamped = Math.min(Math.max(value, -2), 4)
  const pct = ((clamped + 2) / 6) * 100
  const color = value >= 1 ? '#3DD68C' : value >= 0 ? '#A9A8EC' : '#F04438'
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="font-mono text-[11px]" style={{ color }}>{value.toFixed(2)}</span>
    </div>
  )
}

export function RegimeTable({ regimeBreakdown }: RegimeTableProps) {
  const regimes = Object.entries(regimeBreakdown)

  if (regimes.length === 0) {
    return <p className="text-sm text-[#58586A]">No regime data available.</p>
  }

  return (
    <div className="rounded-lg border border-[rgba(255,255,255,0.06)] overflow-hidden">
      <table className="w-full text-sm" aria-label="Performance by vol regime">
        <thead>
          <tr className="bg-[rgba(255,255,255,0.03)] border-b border-[rgba(255,255,255,0.06)]">
            <th className="px-4 py-2.5 text-left   text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Regime</th>
            <th className="px-4 py-2.5 text-right  text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">APY</th>
            <th className="px-4 py-2.5 text-right  text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Max DD</th>
            <th className="px-4 py-2.5 text-right  text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Win Rate</th>
            <th className="px-4 py-2.5 text-left   text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Sharpe</th>
            <th className="px-4 py-2.5 text-right  text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Cycles</th>
          </tr>
        </thead>
        <tbody>
          {regimes.map(([regime, row]) => {
            const meta = REGIME_META[regime] ?? { label: regime, color: '#9191A4', bg: 'transparent' }
            const apyPositive = row.apyPct >= 0
            return (
              <tr key={regime} className="border-b border-[rgba(255,255,255,0.04)] last:border-0 hover:bg-[rgba(255,255,255,0.015)] transition-colors">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span
                      className="text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
                      style={{ color: meta.color, background: meta.bg, border: `1px solid ${meta.color}33` }}
                    >
                      {meta.label}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold font-mono ${apyPositive ? 'text-[#3DD68C]' : 'text-[#F04438]'}`}>
                    {formatPct(row.apyPct)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-[#F04438]">
                    {row.maxDrawdownPct != null ? formatPct(-Math.abs(row.maxDrawdownPct)) : '—'}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className="font-mono text-[#9191A4]">
                    {row.winRate != null ? formatPct(row.winRate * 100) : '—'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {row.sharpe != null ? <SharpeBar value={row.sharpe} /> : <span className="text-[#58586A]">—</span>}
                </td>
                <td className="px-4 py-3 text-right text-[#9191A4]">{row.cycleCount}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
