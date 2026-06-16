import { AlertTriangle, Lock, Users } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { RiskDisclosure } from '@/components/common/RiskDisclosure'
import { LeaderboardCaveat } from '@/components/common/LeaderboardCaveat'
import { type LeaderboardEntry } from '@/lib/api'
import { formatDusdc, formatPct, truncateAddress } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'

interface CopyTradingModalProps {
  entry: LeaderboardEntry | null
  open: boolean
  onClose: () => void
}

const COPY_CAVEAT = 'APY modeled on assumed/synthetic trader flow — testnet has minimal live volume. Numbers are not indicative of mainnet returns.'

export function CopyTradingModal({ entry, open, onClose }: CopyTradingModalProps) {
  if (!entry) return null

  const hasCopyFee = false // Would come from portfolio detail if set

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="uppercase">{entry.portfolioName}</DialogTitle>
          <DialogDescription>
            {STRATEGY_NAMES[entry.strategyType]} · by {truncateAddress(entry.walletAddress)}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Performance preview */}
          <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] divide-y divide-[rgba(255,255,255,0.06)]">
            {[
              ['Total Return', formatPct(entry.totalReturnPct), entry.totalReturnPct >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]'],
              ['Rolling APY', `${entry.rollingApyPct.toFixed(1)}%`, 'text-white'],
              ['Cycles', String(entry.cycleCount), 'text-white'],
              ['Copiers', String(entry.copierCount), 'text-white'],
            ].map(([k, v, cls]) => (
              <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
                <span className="text-[#58586A]">{k}</span>
                <span className={`font-semibold ${cls}`}>{v}</span>
              </div>
            ))}
          </div>

          {/* Performance caveat — always shown */}
          <LeaderboardCaveat caveat={COPY_CAVEAT} />

          {/* Bettor strategy disclosure */}
          <RiskDisclosure strategyType={entry.strategyType} />

          {/* Copy fee / access */}
          <div className="rounded-lg border border-[rgba(169,168,236,0.2)] bg-[rgba(169,168,236,0.06)] p-4">
            <div className="flex items-start gap-3">
              <Lock className="w-4 h-4 text-[#A9A8EC] shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-white mb-1">Encrypted strategy config</p>
                <p className="text-xs text-[#9191A4]">
                  {hasCopyFee
                    ? 'Pay the copy fee to decrypt this strategy\'s exact configuration and deploy an identical portfolio.'
                    : entry.sealBlobId
                      ? 'This strategy\'s config is encrypted on Walrus. Pay to access.'
                      : 'This creator has not encrypted their config yet. You can clone the strategy type manually.'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              alert('Copy trading purchase flow requires the Seal decrypt CLI.\nSee: packages/core/scripts/seal-copy-vault.ts\n\nOn-chain payment and config decryption is implemented in the backend.')
              onClose()
            }}
          >
            <Users className="w-3.5 h-3.5" />
            Access Strategy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
