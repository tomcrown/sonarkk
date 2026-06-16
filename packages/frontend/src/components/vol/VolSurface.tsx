import { type SviExpiry } from '@/lib/api'
import { formatDateTime, formatVol } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'

interface VolSurfaceProps {
  surface: SviExpiry[]
}

function probToColor(prob: number): string {
  // Map 0-1 probability from accent (#A9A8EC) to light accent (#D4CDF9)
  const r = Math.round(169 + (212 - 169) * prob)
  const g = Math.round(168 + (205 - 168) * prob)
  const b = Math.round(236 + (249 - 236) * prob)
  return `rgba(${r},${g},${b},${0.15 + prob * 0.7})`
}

export function VolSurface({ surface }: VolSurfaceProps) {
  if (!surface || surface.length === 0) {
    return <p className="text-sm text-[#58586A]">No surface data available.</p>
  }

  const strikes = surface[0]?.strikes.map((s) => s.k) ?? []

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" aria-label="SVI implied vol surface">
          <thead>
            <tr>
              <th className="pb-2 pr-3 text-left text-[#58586A] font-medium whitespace-nowrap">Expiry</th>
              <th className="pb-2 pr-3 text-left text-[#58586A] font-medium">ATM Vol</th>
              {strikes.map((k) => (
                <th key={k} className="pb-2 px-1 text-center text-[#58586A] font-mono">
                  {k.toFixed(1)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {surface.map((expiry) => (
              <tr key={expiry.expiryMs} className="border-t border-[rgba(255,255,255,0.04)]">
                <td className="py-1.5 pr-3 text-[#9191A4] whitespace-nowrap font-mono">
                  {formatDateTime(expiry.expiryMs)}
                </td>
                <td className="py-1.5 pr-3 font-semibold text-[#D4CDF9]">
                  {formatVol(expiry.atmVol)}
                </td>
                {expiry.strikes.map((strike) => (
                  <td key={strike.k} className="py-1.5 px-1 text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div
                          className="w-8 h-6 rounded mx-auto flex items-center justify-center text-[9px] font-medium text-white cursor-default"
                          style={{ background: probToColor(strike.prob) }}
                          aria-label={`Strike ${strike.k}: prob ${(strike.prob * 100).toFixed(1)}%`}
                        >
                          {(strike.prob * 100).toFixed(0)}
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>k = {strike.k.toFixed(2)}</p>
                        <p>Prob = {(strike.prob * 100).toFixed(2)}%</p>
                        <p>Spread = {(strike.spread * 100).toFixed(2)}%</p>
                        <p>w = {strike.w.toFixed(4)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 flex items-center gap-3">
        <span className="text-[10px] text-[#58586A] uppercase tracking-wider">Probability</span>
        <div className="flex gap-0.5">
          {[0, 0.2, 0.4, 0.6, 0.8, 1.0].map((p) => (
            <div
              key={p}
              className="w-6 h-3 rounded-sm"
              style={{ background: probToColor(p) }}
              aria-hidden
            />
          ))}
        </div>
        <div className="flex items-center justify-between text-[10px] text-[#58586A] gap-1">
          <span>0%</span>
          <span>100%</span>
        </div>
      </div>
    </TooltipProvider>
  )
}
