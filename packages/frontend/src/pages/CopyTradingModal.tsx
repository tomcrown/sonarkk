import { useState, useCallback, useEffect, useRef } from 'react'
import { Lock, CheckCircle, Loader, AlertCircle, ExternalLink, Copy } from 'lucide-react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RiskDisclosure } from '@/components/common/RiskDisclosure'
import { LeaderboardCaveat } from '@/components/common/LeaderboardCaveat'
import { type LeaderboardEntry, type VaultConfigDetail, api } from '@/lib/api'
import { decryptVaultConfig } from '@/lib/seal'
import { formatPct, truncateAddress } from '@/lib/format'
import { STRATEGY_NAMES, BETTOR_STRATEGIES } from '@/lib/constants'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient, useSignPersonalMessage } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { useQueryClient } from '@tanstack/react-query'
import { useChainConfig } from '@/hooks/useChainConfig'
import { txUrl } from '@/lib/sui'
import { motion, AnimatePresence } from 'framer-motion'

interface CopyTradingModalProps {
  entry: LeaderboardEntry | null
  open: boolean
  onClose: () => void
}

const COPY_CAVEAT = 'APY modeled on assumed/synthetic trader flow — testnet has minimal live volume. Not indicative of mainnet returns.'

type Step = 'preview' | 'deposit' | 'copying' | 'done' | 'error'

const DUSDC_DECIMALS = 6
function toRaw(dusdc: string): bigint {
  return BigInt(Math.round(parseFloat(dusdc) * 10 ** DUSDC_DECIMALS))
}

export function CopyTradingModal({ entry, open, onClose }: CopyTradingModalProps) {
  const [step, setStep] = useState<Step>('preview')
  const [depositAmount, setDepositAmount] = useState('200')
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [txDigests, setTxDigests] = useState<string[]>([])
  const [vaultConfigDetail, setVaultConfigDetail] = useState<VaultConfigDetail | null>(null)
  const [copyAccessTicketId, setCopyAccessTicketId] = useState<string | null>(null)
  const [copiedToClipboard, setCopiedToClipboard] = useState(false)
  const clipboardTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const account   = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const { mutateAsync: signPersonalMessage } = useSignPersonalMessage()
  const { data: chainConfig } = useChainConfig()
  const qc = useQueryClient()

  // Prefetch vault config on open so copy fee + slot count are visible in preview
  useEffect(() => {
    if (open && entry) {
      api.vaultConfigs.get(entry.portfolioId)
        .then(setVaultConfigDetail)
        .catch(() => { /* non-fatal; detail is re-fetched during copy */ })
    }
    if (!open) setVaultConfigDetail(null)
  }, [open, entry])

  const handleClose = () => {
    if (step === 'copying') return
    setStep('preview')
    setStatusMsg('')
    setErrorMsg('')
    setTxDigests([])
    setVaultConfigDetail(null)
    setCopyAccessTicketId(null)
    if (clipboardTimer.current) clearTimeout(clipboardTimer.current)
    setCopiedToClipboard(false)
    onClose()
  }

  // Extract portfolioId + policyCapId from TX effects
  const extractObjects = useCallback(async (digest: string) => {
    const tx = await suiClient.getTransactionBlock({
      digest,
      options: { showObjectChanges: true },
    })
    type ObjChange = { type: string; objectId?: string; objectType?: string }
    const changes = (tx.objectChanges ?? []) as ObjChange[]
    const portfolio = changes.find(
      (c) => c.type === 'created' && typeof c.objectType === 'string' && c.objectType.includes('::portfolio::SonarkPortfolio'),
    )
    const policyCap = changes.find(
      (c) => c.type === 'created' && typeof c.objectType === 'string' && c.objectType.includes('::policy::PolicyCap'),
    )
    if (!portfolio?.objectId || !policyCap?.objectId) {
      throw new Error(`Could not find Portfolio/PolicyCap in TX ${digest}`)
    }
    return { portfolioId: portfolio.objectId, policyCapId: policyCap.objectId }
  }, [suiClient])

  // Full Seal copy flow: pay fee → get ticket → decrypt config → deploy all slots
  const handlePurchaseFee = useCallback(async () => {
    if (!entry || !account || !chainConfig?.sonarkPackage || !chainConfig.keeperAddress) {
      setErrorMsg('Wallet not connected or chain config unavailable.')
      setStep('error')
      return
    }
    const detail = vaultConfigDetail ?? await api.vaultConfigs.get(entry.portfolioId)
    if (!vaultConfigDetail) setVaultConfigDetail(detail)

    const portfolioObjId = detail.portfolioObjectIds?.[0]
    if (!portfolioObjId) {
      setErrorMsg('No portfolio object ID found for this vault config.')
      setStep('error')
      return
    }
    if (!detail.sealBlobId) {
      setErrorMsg('This vault has no Seal blob — cannot decrypt config.')
      setStep('error')
      return
    }

    const feeRaw     = BigInt(detail.copyFeeRaw ?? '0')
    const userAddress = account.address
    const PKG    = chainConfig.sonarkPackage
    const DUSDC  = chainConfig.dusdcType
    const CLOCK  = chainConfig.clockId
    const KEEPER = chainConfig.keeperAddress

    setStep('copying')
    setStatusMsg('Paying copy fee on-chain…')
    try {
      // ── Step 1: Pay fee → receive CopyAccessTicket ─────────────────────────
      const feeCoins = await suiClient.getCoins({ owner: userAddress, coinType: DUSDC })
      const feeCoin  = feeCoins.data.find((c) => BigInt(c.balance) >= feeRaw)
      if (!feeCoin) {
        throw new Error(`Insufficient DUSDC for copy fee. Need ${Number(feeRaw) / 1e6} DUSDC.`)
      }

      const feeTxb = new Transaction()
      const [split] = feeTxb.splitCoins(feeTxb.object(feeCoin.coinObjectId), [feeTxb.pure.u64(feeRaw)])
      const ticket = feeTxb.moveCall({
        target: `${PKG}::portfolio::purchase_copy_access`,
        typeArguments: [DUSDC],
        arguments: [feeTxb.object(portfolioObjId), split],
      })
      feeTxb.transferObjects([ticket], userAddress)

      const feeResult = await signAndExecute({ transaction: feeTxb })
      const feeTxDetails = await suiClient.getTransactionBlock({
        digest: feeResult.digest,
        options: { showObjectChanges: true },
      })
      type ObjChange = { type: string; objectId?: string; objectType?: string }
      const createdTicket = ((feeTxDetails.objectChanges ?? []) as ObjChange[]).find(
        (c) => c.type === 'created' && typeof c.objectType === 'string'
          && c.objectType.includes('::portfolio::CopyAccessTicket'),
      )
      if (!createdTicket?.objectId) {
        throw new Error('CopyAccessTicket not found in TX effects')
      }
      const ticketId = createdTicket.objectId

      // ── Step 2: Decrypt config with Seal (wallet signs SessionKey prompt) ──
      setStatusMsg('Signing Seal session key — approve the wallet message prompt…')
      const decryptedConfig = await decryptVaultConfig(
        suiClient,
        chainConfig.sealKeyServerIds ?? [],
        PKG,
        DUSDC,
        portfolioObjId,
        ticketId,
        detail.sealBlobId,
        userAddress,
        chainConfig.walrusAggregatorUrl,
        (input) => signPersonalMessage(input),
      )

      // ── Step 3: Deploy all portfolio slots using decrypted config ───────────
      const totalRaw  = toRaw(depositAmount)
      const budgetRaw = totalRaw / 2n
      const expiryMs  = BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const digests: string[] = [feeResult.digest]
      const portfolioIds: string[] = []

      for (let i = 0; i < decryptedConfig.allocations.length; i++) {
        const alloc = decryptedConfig.allocations[i]!
        const slotDepositRaw = BigInt(Math.floor(Number(totalRaw) * alloc.allocationBps / 10000))

        setStatusMsg(`Creating portfolio ${i + 1} of ${decryptedConfig.allocations.length}…`)
        const tx1 = new Transaction()
        const policyCap = tx1.moveCall({
          target: `${PKG}::portfolio::create`,
          typeArguments: [DUSDC],
          arguments: [tx1.pure.u64(budgetRaw), tx1.pure.u64(expiryMs), tx1.object(CLOCK)],
        })
        tx1.transferObjects([policyCap], KEEPER)
        const res1 = await signAndExecute({ transaction: tx1 })
        digests.push(res1.digest)

        setStatusMsg(`Fetching objects for portfolio ${i + 1}…`)
        const { portfolioId, policyCapId } = await extractObjects(res1.digest)
        portfolioIds.push(portfolioId)

        setStatusMsg(`Depositing into portfolio ${i + 1}…`)
        const coins = await suiClient.getCoins({ owner: userAddress, coinType: DUSDC })
        const coin  = coins.data.find((c) => BigInt(c.balance) >= slotDepositRaw)
        if (!coin) {
          throw new Error(`Insufficient DUSDC for portfolio ${i + 1}. Need ${Number(slotDepositRaw) / 1e6} DUSDC.`)
        }
        const tx2 = new Transaction()
        const [splitCoin] = tx2.splitCoins(tx2.object(coin.coinObjectId), [tx2.pure.u64(slotDepositRaw)])
        const share = tx2.moveCall({
          target: `${PKG}::portfolio::deposit`,
          typeArguments: [DUSDC],
          arguments: [tx2.object(portfolioId), splitCoin, tx2.object(CLOCK)],
        })
        tx2.transferObjects([share], userAddress)
        const res2 = await signAndExecute({ transaction: tx2 })
        digests.push(res2.digest)

        setStatusMsg(`Registering portfolio ${i + 1} with keeper…`)
        await api.portfolios.create({
          object_id:       portfolioId,
          policy_cap_id:   policyCapId,
          owner_address:   userAddress,
          strategy_type:   alloc.strategyType,
          name:            `${detail.name} #${i + 1} (copy)`,
          initial_deposit_raw: slotDepositRaw.toString(),
          util_target:         alloc.utilTarget,
          strike_selection:    alloc.strikeSelection,
          liquidity_reserve_pct: alloc.liquidityReservePct,
          drawdown_pause_threshold_pct: alloc.drawdownPauseThresholdPct,
          vol_target_bps:      alloc.volTargetBps,
          hedge_multiplier:    alloc.hedgeMultiplier,
        })
      }

      // ── Step 4: Record the copy relationship ─────────────────────────────────
      setStatusMsg('Recording copy relationship…')
      await api.vaultConfigs.copy(entry.portfolioId, {
        follower_address: userAddress,
        portfolio_ids:    portfolioIds,
      })

      setTxDigests(digests)
      void qc.invalidateQueries({ queryKey: ['portfolios'] })
      setStep('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }, [entry, account, chainConfig, vaultConfigDetail, suiClient, signAndExecute, signPersonalMessage, depositAmount, extractObjects, qc])

  const handleCopy = useCallback(async () => {
    if (!entry || !account || !chainConfig?.keeperAddress || !chainConfig.sonarkPackage) {
      setErrorMsg('Wallet not connected or chain config unavailable.')
      setStep('error')
      return
    }

    const userAddress = account.address
    const PKG   = chainConfig.sonarkPackage
    const DUSDC = chainConfig.dusdcType
    const CLOCK = chainConfig.clockId
    const KEEPER = chainConfig.keeperAddress

    try {
      setStep('copying')
      // Use prefetched detail or fetch if not yet available
      setStatusMsg('Fetching strategy config…')
      const detail = vaultConfigDetail ?? await api.vaultConfigs.get(entry.portfolioId)
      if (!vaultConfigDetail) setVaultConfigDetail(detail)

      if (detail.sealBlobId) {
        throw new Error(
          'This strategy uses Seal encryption. ' +
          'Run packages/core/scripts/seal-copy-vault.ts to decrypt and deploy a copy.',
        )
      }

      const totalRaw    = toRaw(depositAmount)
      const budgetRaw   = totalRaw / 2n
      const expiryMs    = BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000)
      const digests: string[] = []
      const portfolioIds: string[] = []

      // ── Deploy one portfolio per allocation slot ──────────────────────────
      for (let i = 0; i < detail.allocations.length; i++) {
        const alloc = detail.allocations[i]!
        const slotDepositRaw = BigInt(
          Math.floor(Number(totalRaw) * alloc.allocationBps / 10000),
        )

        setStatusMsg(`Creating portfolio ${i + 1} of ${detail.allocations.length}…`)

        // TX: create portfolio + transfer PolicyCap to keeper
        const tx1 = new Transaction()
        const policyCap = tx1.moveCall({
          target: `${PKG}::portfolio::create`,
          typeArguments: [DUSDC],
          arguments: [tx1.pure.u64(budgetRaw), tx1.pure.u64(expiryMs), tx1.object(CLOCK)],
        })
        tx1.transferObjects([policyCap], KEEPER)
        const res1 = await signAndExecute({ transaction: tx1 })
        digests.push(res1.digest)

        setStatusMsg(`Fetching objects for portfolio ${i + 1}…`)
        const { portfolioId, policyCapId } = await extractObjects(res1.digest)
        portfolioIds.push(portfolioId)

        // TX: deposit DUSDC
        setStatusMsg(`Depositing into portfolio ${i + 1}…`)
        const coins = await suiClient.getCoins({ owner: userAddress, coinType: DUSDC })
        const coin  = coins.data.find((c) => BigInt(c.balance) >= slotDepositRaw)
        if (!coin) {
          throw new Error(`Insufficient DUSDC for portfolio ${i + 1}. Need ${Number(slotDepositRaw) / 1e6} DUSDC.`)
        }
        const tx2 = new Transaction()
        const [split] = tx2.splitCoins(tx2.object(coin.coinObjectId), [tx2.pure.u64(slotDepositRaw)])
        const share = tx2.moveCall({
          target: `${PKG}::portfolio::deposit`,
          typeArguments: [DUSDC],
          arguments: [tx2.object(portfolioId), split, tx2.object(CLOCK)],
        })
        tx2.transferObjects([share], userAddress)
        const res2 = await signAndExecute({ transaction: tx2 })
        digests.push(res2.digest)

        // Register with backend
        setStatusMsg(`Registering portfolio ${i + 1} with keeper…`)
        await api.portfolios.create({
          object_id:       portfolioId,
          policy_cap_id:   policyCapId,
          owner_address:   userAddress,
          strategy_type:   alloc.strategyType,
          name:            `${detail.name} #${i + 1} (copy)`,
          initial_deposit_raw: slotDepositRaw.toString(),
          util_target:         alloc.utilTarget,
          strike_selection:    alloc.strikeSelection,
          liquidity_reserve_pct: alloc.liquidityReservePct,
          drawdown_pause_threshold_pct: alloc.drawdownPauseThresholdPct,
          vol_target_bps:      alloc.volTargetBps,
          hedge_multiplier:    alloc.hedgeMultiplier,
        })
      }

      // ── Record the copy relationship ──────────────────────────────────────
      setStatusMsg('Recording copy relationship…')
      await api.vaultConfigs.copy(entry.portfolioId, {
        follower_address: userAddress,
        portfolio_ids:    portfolioIds,
      })

      setTxDigests(digests)
      void qc.invalidateQueries({ queryKey: ['portfolios'] })
      setStep('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }, [entry, account, chainConfig, depositAmount, signAndExecute, suiClient, extractObjects, qc])

  if (!entry) return null

  const hasBettorStrategy = BETTOR_STRATEGIES.has(entry.strategyType)
  const isSealed = !!entry.sealBlobId
  const isProcessing = step === 'copying'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="uppercase">{entry.portfolioName}</DialogTitle>
          <DialogDescription>
            {STRATEGY_NAMES[entry.strategyType]} · by {truncateAddress(entry.walletAddress)}
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">

          {/* ── Preview ─────────────────────────────────────────────────── */}
          {step === 'preview' && (
            <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="rounded-lg border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)] divide-y divide-[rgba(255,255,255,0.06)]">
                {([
                  ['Total Return', entry.totalReturnPct != null ? formatPct(entry.totalReturnPct) : '—', (entry.totalReturnPct ?? 0) >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]'],
                  ['Rolling APY',  entry.rollingApyPct != null ? `${entry.rollingApyPct.toFixed(1)}%` : '—', 'text-white'],
                  ['Cycles',       String(entry.cycleCount),   'text-white'],
                  ['Copiers',      String(entry.copierCount),  'text-white'],
                  ['Strategies',   vaultConfigDetail ? String(vaultConfigDetail.allocations.length) : '—', 'text-white'],
                  ['Copy Fee',
                    vaultConfigDetail
                      ? (vaultConfigDetail.copyFeeRaw && BigInt(vaultConfigDetail.copyFeeRaw) > 0n
                          ? `${(Number(vaultConfigDetail.copyFeeRaw) / 1e6).toFixed(2)} DUSDC`
                          : 'Free')
                      : '—',
                    'text-white',
                  ],
                ] as [string, string, string][]).map(([k, v, cls]) => (
                  <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
                    <span className="text-[#58586A]">{k}</span>
                    <span className={`font-semibold ${cls}`}>{v}</span>
                  </div>
                ))}
              </div>

              <LeaderboardCaveat caveat={COPY_CAVEAT} />
              {hasBettorStrategy && <RiskDisclosure strategyType={entry.strategyType} />}

              {isSealed && (
                <div className="rounded-lg border border-[rgba(169,168,236,0.2)] bg-[rgba(169,168,236,0.06)] p-4">
                  <div className="flex items-start gap-3">
                    <Lock className="w-4 h-4 text-[#A9A8EC] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-sm font-medium text-white mb-1">Seal-encrypted config</p>
                      <p className="text-xs text-[#9191A4]">
                        Pay the fee on-chain → your browser decrypts the strategy config → your copy is deployed automatically. No CLI required.
                      </p>
                    </div>
                  </div>
                </div>
              )}
              <div className="space-y-1.5">
                <Label>Your deposit (DUSDC)</Label>
                <Input
                  type="number" min="10"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="200"
                />
                <p className="text-[10px] text-[#58586A]">
                  Will be split across strategy slots matching the original allocation.
                </p>
              </div>
            </motion.div>
          )}

          {/* ── In progress ─────────────────────────────────────────────── */}
          {isProcessing && (
            <motion.div key="copying" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-6 space-y-4">
              <div className="flex items-center gap-3">
                <Loader className="w-5 h-5 animate-spin shrink-0" style={{ color: 'var(--accent)' }} />
                <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>{statusMsg}</p>
              </div>
              <p className="text-xs pl-8" style={{ color: 'var(--ink-muted)' }}>
                {isSealed
                  ? 'Approve each prompt — fee TX, 1 Seal message signature, then portfolio creation TXs'
                  : `Approve each wallet prompt — ${vaultConfigDetail
                      ? `${vaultConfigDetail.allocations.length * 2} transactions total`
                      : 'multiple transactions'
                    }`
                }
              </p>
            </motion.div>
          )}

          {/* ── Done ────────────────────────────────────────────────────── */}
          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="py-6 text-center space-y-4">
              <CheckCircle className="w-10 h-10 mx-auto" style={{ color: 'var(--status-green)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {copyAccessTicketId ? 'Copy access purchased!' : `${entry.portfolioName} copied!`}
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--ink-secondary)' }}>
                  {copyAccessTicketId
                    ? 'Your CopyAccessTicket is in your wallet. Use the CLI to decrypt and deploy.'
                    : 'Your portfolios are live and will run the same strategy automatically.'
                  }
                </p>
              </div>
              {copyAccessTicketId && (
                <div className="text-left space-y-1.5">
                  <p className="text-xs font-medium" style={{ color: 'var(--ink-secondary)' }}>CopyAccessTicket object ID</p>
                  <div className="flex items-center gap-2 rounded-lg px-3 py-2.5"
                    style={{ background: 'var(--bg-inset)', border: '1px solid var(--line)' }}>
                    <code className="text-xs flex-1 truncate" style={{ color: '#A9A8EC' }}>
                      {copyAccessTicketId}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        void navigator.clipboard.writeText(copyAccessTicketId)
                        setCopiedToClipboard(true)
                        if (clipboardTimer.current) clearTimeout(clipboardTimer.current)
                        clipboardTimer.current = setTimeout(() => setCopiedToClipboard(false), 2000)
                      }}
                      className="text-xs shrink-0 transition-colors"
                      style={{ color: copiedToClipboard ? 'var(--status-green)' : 'var(--ink-muted)' }}
                    >
                      {copiedToClipboard ? 'Copied!' : <Copy className="w-3.5 h-3.5" />}
                    </button>
                  </div>
                  <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                    Pass this to <code>pnpm --filter @sonarkk/keeper run seal-copy</code>
                  </p>
                </div>
              )}
              <div className="flex flex-col gap-1 items-center">
                {txDigests.map((d, i) => (
                  <a key={d} href={txUrl(d)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--accent)' }}>
                    TX {i + 1} <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {step === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4">
              <div className="flex items-start gap-2 rounded-lg px-4 py-3" style={{ background: 'rgba(240,68,56,0.08)', border: '1px solid rgba(240,68,56,0.2)' }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--status-red)' }} />
                <p className="text-sm" style={{ color: 'var(--status-red)' }}>{errorMsg}</p>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        <DialogFooter>
          {step === 'done' ? (
            <Button onClick={handleClose}>Close</Button>
          ) : step === 'error' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Close</Button>
              <Button onClick={() => { setStep('preview'); setErrorMsg('') }}>Try again</Button>
            </>
          ) : step === 'preview' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              {isSealed
                ? (
                  <Button
                    onClick={handlePurchaseFee}
                    disabled={!account || parseFloat(depositAmount) < 10}
                  >
                    {!account
                      ? 'Connect wallet'
                      : vaultConfigDetail?.copyFeeRaw && BigInt(vaultConfigDetail.copyFeeRaw) > 0n
                        ? `Pay ${(Number(vaultConfigDetail.copyFeeRaw) / 1e6).toFixed(2)} DUSDC & Deploy Copy`
                        : 'Decrypt & Deploy Copy'
                    }
                  </Button>
                ) : (
                  <Button
                    onClick={handleCopy}
                    disabled={!account || parseFloat(depositAmount) < 10}
                  >
                    {!account ? 'Connect wallet' : 'Copy Strategy'}
                  </Button>
                )
              }
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
