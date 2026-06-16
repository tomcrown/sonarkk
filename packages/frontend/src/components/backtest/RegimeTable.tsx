import { formatPct } from '@/lib/format'

interface RegimeTableProps {
  regimeBreakdown: Record<string, { apyPct: number; cycleCount: number }>
}

const REGIME_LABELS: Record<string, { label: string; color: string }> = {
  calm: { label: 'Calm (vol < 30%)', color: '#3DD68C' },
  normal: { label: 'Normal (30–60%)', color: '#E8A627' },
  high: { label: 'High (vol > 60%)', color: '#F04438' },
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
            <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Regime</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">APY</th>
            <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Cycles</th>
          </tr>
        </thead>
        <tbody>
          {regimes.map(([regime, { apyPct, cycleCount }]) => {
            const meta = REGIME_LABELS[regime] ?? { label: regime, color: '#9191A4' }
            return (
              <tr key={regime} className="border-b border-[rgba(255,255,255,0.04)] last:border-0">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full shrink-0" style={{ background: meta.color }} />
                    <span className="text-[#9191A4]">{meta.label}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right">
                  <span className={`font-semibold ${apyPct >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]'}`}>
                    {formatPct(apyPct)}
                  </span>
                </td>
                <td className="px-4 py-3 text-right text-[#9191A4]">{cycleCount}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
