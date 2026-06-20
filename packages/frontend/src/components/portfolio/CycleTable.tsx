import { ExternalLink } from 'lucide-react'
import { type KeeperCycle } from '@/lib/api'
import { formatDateTime, formatDusdc } from '@/lib/format'
import { txUrl } from '@/lib/sui'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/cn'

interface CycleTableProps {
  cycles: KeeperCycle[]
  strategyType?: number
}

function statusVariant(status: string): 'live' | 'success' | 'danger' | 'muted' {
  if (status === 'completed') return 'live'
  if (status === 'failed' || status === 'error') return 'danger'
  if (status === 'skipped') return 'muted'
  return 'muted'
}

function TxLink({ digest, label, color }: { digest: string; label: string; color?: string }) {
  return (
    <a
      href={txUrl(digest)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors hover:opacity-80"
      style={{
        color: color ?? '#A9A8EC',
        borderColor: `${color ?? '#A9A8EC'}44`,
        background: `${color ?? '#A9A8EC'}0f`,
      }}
      title={digest}
    >
      {label} <ExternalLink className="w-2.5 h-2.5" />
    </a>
  )
}

export function CycleTable({ cycles, strategyType }: CycleTableProps) {
  const isHedged = strategyType === 1 || strategyType === 2

  if (cycles.length === 0) {
    return <p className="text-sm text-[#58586A] py-4">No cycles recorded yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="Keeper cycle history">
        <thead>
          <tr className="border-b border-[rgba(255,255,255,0.06)]">
            {['Time', 'Action', 'PnL', 'ATM Vol', 'Status', 'Transactions'].map((h) => (
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
                <div className="flex flex-col gap-1">
                  {cycle.txDigest && (
                    <TxLink
                      digest={cycle.txDigest}
                      label="Predict ↗"
                      color="#A9A8EC"
                    />
                  )}
                  {cycle.hedgeTxDigest && (
                    <TxLink
                      digest={cycle.hedgeTxDigest}
                      label={`Spot hedge ${cycle.hedgeDirection === 'long' ? '↑' : cycle.hedgeDirection === 'short' ? '↓' : ''}${cycle.coverageRatioPct != null ? ` ${cycle.coverageRatioPct.toFixed(0)}%` : ''}`}
                      color="#6ee7b7"
                    />
                  )}
                  {!cycle.txDigest && !cycle.hedgeTxDigest && (
                    <span className="text-[#58586A] text-xs">—</span>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {isHedged && (
        <p className="text-[10px] text-[#58586A] mt-3">
          Hedged PLP fires two separate transactions per cycle: one to DeepBook Predict (supply), one to DeepBook Spot (delta hedge).
        </p>
      )}
    </div>
  )
}
