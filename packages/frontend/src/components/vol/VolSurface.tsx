/**
 * VolSurface — Term structure table for active sub-hour oracles.
 *
 * For options expiring in minutes, the implied vol smile blows up at
 * off-ATM strikes (sqrt(w/T) → ∞ as T → 0). The only robust cross-expiry
 * metrics are ATM vol (robust near expiry) and spread (protocol-bounded).
 * We therefore show a term structure table instead of a smile grid.
 */
import { type SviExpiry } from '@/lib/api'
import { formatDateTime, formatVol } from '@/lib/format'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
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
  if (vol < 0.25) return '#3DD68C'   // calm — green
  if (vol < 0.50) return '#A9A8EC'   // normal — accent
  return '#F04438'                    // high — red
}

function volRegimeLabel(vol: number): string {
  if (vol < 0.25) return 'Calm'
  if (vol < 0.50) return 'Normal'
  return 'High'
}

export function VolSurface({ surface }: VolSurfaceProps) {
  if (!surface || surface.length === 0) {
    return <p className="text-sm text-[#58586A]">No surface data available.</p>
  }

  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <table className="w-full text-xs" aria-label="Vol term structure">
          <thead>
            <tr>
              <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">Expiry</th>
              <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">TTX</th>
              <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">ATM Vol</th>
              <th className="pb-2 pr-4 text-left text-[#58586A] font-medium whitespace-nowrap">Regime</th>
              <th className="pb-2 text-left text-[#58586A] font-medium whitespace-nowrap">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="cursor-help border-b border-dotted border-[#58586A]">
                      Spread@ATM
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>House income per unit notional on an ATM bet.</p>
                    <p className="text-[10px] text-muted-foreground mt-1">Assumes 30% pool utilization.</p>
                  </TooltipContent>
                </Tooltip>
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
                      style={{
                        color,
                        background: `${color}1a`,
                        border: `1px solid ${color}33`,
                      }}
                    >
                      {label}
                    </span>
                  </td>
                  <td className="py-2">
                    <span
                      className={cn(
                        'font-semibold',
                        spread != null && spread > 0.02
                          ? 'text-[#3DD68C]'
                          : 'text-[#A9A8EC]'
                      )}
                    >
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
        <span className="font-semibold text-[#9191A4]">How to read this: </span>
        ATM vol = how expensive options are this cycle. Higher vol = wider spread = more income for house strategies.
        Spread@ATM = what PLP Supplier and Hedged PLP earn per bet placed at the current BTC price.
        Keeper picks the nearest expiry that clears its per-strategy vol floor.
      </div>
    </TooltipProvider>
  )
}
