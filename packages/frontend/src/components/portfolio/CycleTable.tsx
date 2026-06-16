import { ExternalLink } from 'lucide-react'
import { type KeeperCycle } from '@/lib/api'
import { formatDateTime, formatDusdc } from '@/lib/format'
import { txUrl } from '@/lib/sui'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

interface CycleTableProps {
  cycles: KeeperCycle[]
}

function statusVariant(status: string): 'live' | 'success' | 'danger' | 'muted' {
  if (status === 'completed') return 'live'
  if (status === 'failed' || status === 'error') return 'danger'
  if (status === 'skipped') return 'muted'
  return 'muted'
}

export function CycleTable({ cycles }: CycleTableProps) {
  if (cycles.length === 0) {
    return <p className="text-sm text-[#58586A] py-4">No cycles recorded yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Keeper cycle history">
        <thead>
          <tr className="border-b border-[rgba(255,255,255,0.06)]">
            {['Time', 'Action', 'PnL', 'ATM Vol', 'Status', 'Tx'].map((h) => (
              <th
                key={h}
                className="pb-2 text-left text-[10px] font-semibold uppercase tracking-[0.12em] text-[#58586A]"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {cycles.map((cycle) => (
            <tr
              key={cycle.id}
              className="border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(169,168,236,0.04)] transition-colors"
            >
              <td className="py-2.5 pr-4 text-[#9191A4] whitespace-nowrap text-xs">
                {formatDateTime(cycle.createdAt)}
              </td>
              <td className="py-2.5 pr-4 font-mono text-xs text-white uppercase">
                {cycle.action}
              </td>
              <td className={cn(
                'py-2.5 pr-4 text-xs font-medium',
                cycle.pnlRaw
                  ? parseFloat(cycle.pnlRaw) >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]'
                  : 'text-[#58586A]',
              )}>
                {cycle.pnlRaw ? formatDusdc(cycle.pnlRaw) : '—'}
              </td>
              <td className="py-2.5 pr-4 text-xs text-[#9191A4]">
                {cycle.atmVol ? `${(cycle.atmVol * 100).toFixed(1)}%` : '—'}
              </td>
              <td className="py-2.5 pr-4">
                <Badge variant={statusVariant(cycle.status)}>
                  {cycle.status}
                </Badge>
              </td>
              <td className="py-2.5">
                {cycle.txDigest ? (
                  <a
                    href={txUrl(cycle.txDigest)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#A9A8EC] hover:text-[#D4CDF9] transition-colors"
                    aria-label={`View transaction ${cycle.txDigest.slice(0, 8)}`}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                ) : (
                  <span className="text-[#58586A]">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
