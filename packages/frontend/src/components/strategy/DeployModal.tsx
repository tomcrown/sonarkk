import { useState, useCallback } from 'react'
import { ArrowRight, CheckCircle, Loader, AlertCircle, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { useQueryClient } from '@tanstack/react-query'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RiskDisclosure } from '@/components/common/RiskDisclosure'
import { STRATEGY_NAMES, BETTOR_STRATEGIES } from '@/lib/constants'
import { useChainConfig } from '@/hooks/useChainConfig'
import { api } from '@/lib/api'
import { txUrl } from '@/lib/sui'

interface DeployModalProps {
  strategyType: number | null
  open: boolean
  onClose: () => void
}

interface DeployConfig {
  name: string
  initialDeposit: string
  utilTarget: string
  strikeSelection: string
  liquidityReservePct: string
  drawdownPauseThresholdPct: string
  volTargetBps: string
  hedgeMultiplier: string
}

type Step = 'config' | 'confirm' | 'deploying' | 'depositing' | 'enabling' | 'registering' | 'done' | 'error'

const DUSDC_DECIMALS = 6

function toRaw(dusdc: string): bigint {
  return BigInt(Math.round(parseFloat(dusdc) * 10 ** DUSDC_DECIMALS))
}

export function DeployModal({ strategyType, open, onClose }: DeployModalProps) {
  const [config, setConfig] = useState<DeployConfig>({
    name: '',
    initialDeposit: '100',
    utilTarget: '0.25',
    strikeSelection: 'ATM',
    liquidityReservePct: '0.10',
    drawdownPauseThresholdPct: '0.15',
    volTargetBps: '2000',
    hedgeMultiplier: '1.0',
  })
  const [step, setStep] = useState<Step>('config')
  const [statusMsg, setStatusMsg] = useState('')
  const [tx1Digest, setTx1Digest] = useState('')
  const [tx2Digest, setTx2Digest] = useState('')
  const [setupTxDigest, setSetupTxDigest] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const { data: chainConfig } = useChainConfig()
  const qc = useQueryClient()

  // Derived — computed unconditionally so hooks order is stable
  const name     = STRATEGY_NAMES[strategyType ?? 0] ?? `Strategy ${strategyType ?? 0}`
  const isBettor = BETTOR_STRATEGIES.has(strategyType ?? 0)

  const needsKeeperSetup = strategyType === 3 || strategyType === 7

  const handleClose = () => {
    if (step === 'deploying' || step === 'depositing' || step === 'enabling' || step === 'registering') return
    setStep('config')
    setStatusMsg('')
    setTx1Digest('')
    setTx2Digest('')
    setSetupTxDigest('')
    setErrorMsg('')
    onClose()
  }

  const handleDeploy = useCallback(async () => {
    if (strategyType === null) return
    if (!account || !chainConfig?.keeperAddress || !chainConfig.sonarkPackage) {
      setErrorMsg('Wallet not connected or chain config unavailable.')
      setStep('error')
      return
    }

    const userAddress = account.address
    const depositRaw = toRaw(config.initialDeposit)
    const budgetCapRaw = depositRaw * 500n  // ~2000 cycles before refresh needed
    const expiryMs = BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

    const PKG   = chainConfig.sonarkPackage
    const DUSDC = chainConfig.dusdcType
    const CLOCK = chainConfig.clockId
    const KEEPER = chainConfig.keeperAddress

    try {
      // ── TX 1: Create portfolio + transfer PolicyCap to keeper ─────────────
      setStep('deploying')
      setStatusMsg('Creating portfolio on-chain…')

      const tx1 = new Transaction()
      const policyCap = tx1.moveCall({
        target: `${PKG}::portfolio::create`,
        typeArguments: [DUSDC],
        arguments: [
          tx1.pure.u64(budgetCapRaw),
          tx1.pure.u64(expiryMs),
          tx1.object(CLOCK),
        ],
      })
      tx1.transferObjects([policyCap], KEEPER)

      const result1 = await signAndExecute({ transaction: tx1 })
      setTx1Digest(result1.digest)
      setStatusMsg('Fetching created objects…')

      // Fetch full object changes to extract portfolioId and policyCapId
      const txBlock1 = await suiClient.getTransactionBlock({
        digest: result1.digest,
        options: { showObjectChanges: true },
      })

      type ObjChange = {
        type: string
        objectId?: string
        objectType?: string
        owner?: unknown
      }
      const changes = (txBlock1.objectChanges ?? []) as ObjChange[]

      const portfolioChange = changes.find(
        (c) =>
          c.type === 'created' &&
          typeof c.objectType === 'string' &&
          c.objectType.includes('::portfolio::SonarkPortfolio'),
      )
      const policyChange = changes.find(
        (c) =>
          c.type === 'created' &&
          typeof c.objectType === 'string' &&
          c.objectType.includes('::policy::PolicyCap'),
      )

      if (!portfolioChange?.objectId || !policyChange?.objectId) {
        throw new Error('Could not find portfolio/PolicyCap in TX effects. Check explorer: ' + result1.digest)
      }

      const portfolioId = portfolioChange.objectId
      const policyCapId = policyChange.objectId

      // ── TX 2: Deposit DUSDC into portfolio ────────────────────────────────
      setStep('depositing')
      setStatusMsg(`Depositing ${config.initialDeposit} DUSDC…`)

      // Find a DUSDC coin with enough balance
      const coins = await suiClient.getCoins({ owner: userAddress, coinType: DUSDC })
      const coin = coins.data.find((c) => BigInt(c.balance) >= depositRaw)
      if (!coin) {
        throw new Error(
          `Insufficient DUSDC balance. Need ${config.initialDeposit} DUSDC. ` +
          `Get testnet DUSDC from the faucet.`,
        )
      }

      const tx2 = new Transaction()
      const [depositCoin] = tx2.splitCoins(tx2.object(coin.coinObjectId), [
        tx2.pure.u64(depositRaw),
      ])
      const shareToken = tx2.moveCall({
        target: `${PKG}::portfolio::deposit`,
        typeArguments: [DUSDC],
        arguments: [tx2.object(portfolioId), depositCoin, tx2.object(CLOCK)],
      })
      // PortfolioShare is an owned object — transfer to user so they can withdraw later
      tx2.transferObjects([shareToken], userAddress)

      const result2 = await signAndExecute({ transaction: tx2 })
      setTx2Digest(result2.digest)

      // ── Register in backend DB ────────────────────────────────────────────
      setStep('registering')
      setStatusMsg('Registering with keeper…')

      await api.portfolios.create({
        object_id:              portfolioId,
        policy_cap_id:          policyCapId,
        owner_address:          userAddress,
        strategy_type:          strategyType,
        name:                   config.name || undefined,
        initial_deposit_raw:    depositRaw.toString(),
        util_target:            parseFloat(config.utilTarget),
        strike_selection:       isBettor ? config.strikeSelection : 'ATM',
        liquidity_reserve_pct:  parseFloat(config.liquidityReservePct),
        drawdown_pause_threshold_pct: config.drawdownPauseThresholdPct && config.drawdownPauseThresholdPct !== '0'
          ? parseFloat(config.drawdownPauseThresholdPct)
          : null,
        vol_target_bps: strategyType === 5 ? parseInt(config.volTargetBps) : null,
        hedge_multiplier: strategyType === 1 ? parseFloat(config.hedgeMultiplier) : undefined,
      })

      // Invalidate portfolio list so Dashboard/Portfolios page refreshes
      void qc.invalidateQueries({ queryKey: ['portfolios'] })

      // ── TX3 (keeper-signed): enable strategy for PP + Margin Loop ─────────
      // Runs AFTER DB registration so updateMany finds the row.
      if (needsKeeperSetup) {
        setStep('enabling')
        setStatusMsg('Enabling strategy on-chain (keeper-signed)…')
        const setupRes = await api.portfolios.keeperSetup({
          portfolio_id:  portfolioId,
          policy_cap_id: policyCapId,
          strategy_type: strategyType,
          deposit_raw:   depositRaw.toString(),
        })
        if (setupRes.error) throw new Error(`Keeper setup failed: ${setupRes.error}`)
        if (!setupRes.manager_id) throw new Error('Keeper setup succeeded but no managerId returned — check API logs')
        if (setupRes.setup_tx_digest) setSetupTxDigest(setupRes.setup_tx_digest)
      }

      setStep('done')
      setStatusMsg('Portfolio live — keeper will act on the next expiry.')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }, [account, chainConfig, config, isBettor, signAndExecute, suiClient, strategyType, qc])

  const isProcessing = step === 'deploying' || step === 'depositing' || step === 'enabling' || step === 'registering'

  // Early return AFTER all hooks — never return before hooks or their count changes per render
  if (strategyType === null) return null

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="gradient-text">Deploy {name}</DialogTitle>
          <DialogDescription>
            Configure your strategy parameters. The keeper will execute automatically on every ~2h expiry.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">

          {/* ── Config ─────────────────────────────────────────────────── */}
          {step === 'config' && (
            <motion.div
              key="config"
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              className="space-y-4"
            >
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="deploy-name">Portfolio Name</Label>
                  <Input
                    id="deploy-name"
                    placeholder={`My ${name}`}
                    value={config.name}
                    onChange={(e) => setConfig((c) => ({ ...c, name: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="deploy-deposit">Initial Deposit (DUSDC)</Label>
                  <Input
                    id="deploy-deposit"
                    type="number"
                    min="1"
                    value={config.initialDeposit}
                    onChange={(e) => setConfig((c) => ({ ...c, initialDeposit: e.target.value }))}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="deploy-util">Utilization Target</Label>
                  <Select
                    value={config.utilTarget}
                    onValueChange={(v) => setConfig((c) => ({ ...c, utilTarget: v }))}
                  >
                    <SelectTrigger id="deploy-util"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.05">5% (conservative)</SelectItem>
                      <SelectItem value="0.10">10%</SelectItem>
                      <SelectItem value="0.25">25% (balanced)</SelectItem>
                      <SelectItem value="0.50">50%</SelectItem>
                      <SelectItem value="0.75">75% (aggressive)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="deploy-reserve">Liquidity Reserve</Label>
                  <Select
                    value={config.liquidityReservePct}
                    onValueChange={(v) => setConfig((c) => ({ ...c, liquidityReservePct: v }))}
                  >
                    <SelectTrigger id="deploy-reserve"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.05">5%</SelectItem>
                      <SelectItem value="0.10">10%</SelectItem>
                      <SelectItem value="0.20">20%</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="deploy-drawdown">Drawdown Pause</Label>
                  <Select
                    value={config.drawdownPauseThresholdPct}
                    onValueChange={(v) => setConfig((c) => ({ ...c, drawdownPauseThresholdPct: v }))}
                  >
                    <SelectTrigger id="deploy-drawdown"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">Disabled</SelectItem>
                      <SelectItem value="0.10">10%</SelectItem>
                      <SelectItem value="0.15">15% (recommended)</SelectItem>
                      <SelectItem value="0.20">20%</SelectItem>
                      <SelectItem value="0.30">30%</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Hedged PLP only: hedge multiplier */}
                {strategyType === 1 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="deploy-hedge">Hedge Multiplier</Label>
                    <Select
                      value={config.hedgeMultiplier}
                      onValueChange={(v) => setConfig((c) => ({ ...c, hedgeMultiplier: v }))}
                    >
                      <SelectTrigger id="deploy-hedge"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0.5">0.5× (partial hedge)</SelectItem>
                        <SelectItem value="1.0">1.0× (full hedge)</SelectItem>
                        <SelectItem value="1.5">1.5× (over-hedge)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Bettor strategies only: strike selection */}
                {isBettor && (
                  <div className="space-y-1.5">
                    <Label htmlFor="deploy-strike">Strike Selection</Label>
                    <Select
                      value={config.strikeSelection}
                      onValueChange={(v) => setConfig((c) => ({ ...c, strikeSelection: v }))}
                    >
                      <SelectTrigger id="deploy-strike"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="ATM">ATM</SelectItem>
                        <SelectItem value="OTM_1">OTM +1</SelectItem>
                        <SelectItem value="OTM_2">OTM +2</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Vol-Targeted Range only: volatility target */}
                {strategyType === 5 && (
                  <div className="space-y-1.5">
                    <Label htmlFor="deploy-voltarget">Vol Target</Label>
                    <Select
                      value={config.volTargetBps}
                      onValueChange={(v) => setConfig((c) => ({ ...c, volTargetBps: v }))}
                    >
                      <SelectTrigger id="deploy-voltarget"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1500">15%</SelectItem>
                        <SelectItem value="2000">20% (balanced)</SelectItem>
                        <SelectItem value="3000">30%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>

              {isBettor && <RiskDisclosure strategyType={strategyType} />}
            </motion.div>
          )}

          {/* ── Confirm ────────────────────────────────────────────────── */}
          {step === 'confirm' && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              className="space-y-3"
            >
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                {needsKeeperSetup
                  ? 'Two wallet signatures required. The keeper enables the strategy automatically.'
                  : 'Two wallet signatures required: one to create the portfolio, one to deposit DUSDC.'
                }
              </p>
              <div
                className="rounded-lg divide-y"
                style={{ border: '1px solid var(--line)', background: 'var(--bg-inset)' }}
              >
                {[
                  ['Name', config.name || `My ${name}`],
                  ['Deposit', `${config.initialDeposit} DUSDC`],
                  ['Utilization', `${(parseFloat(config.utilTarget) * 100).toFixed(0)}%`],
                  ['Reserve', `${(parseFloat(config.liquidityReservePct) * 100).toFixed(0)}%`],
                  ['Drawdown Pause', config.drawdownPauseThresholdPct === '0' ? 'Disabled' : `${(parseFloat(config.drawdownPauseThresholdPct) * 100).toFixed(0)}%`],
                  ...(strategyType === 1 ? [['Hedge Multiplier', `${config.hedgeMultiplier}×`]] : []),
                  ...(isBettor ? [['Strike', config.strikeSelection]] : []),
                  ...(strategyType === 5 ? [['Vol Target', `${(parseInt(config.volTargetBps) / 100).toFixed(0)}%`]] : []),
                  ['PolicyCap budget', `${(parseFloat(config.initialDeposit) * 0.5).toFixed(0)} DUSDC / cycle`],
                  ['PolicyCap expiry', '30 days'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
                    <span style={{ color: 'var(--ink-muted)' }}>{k}</span>
                    <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>{v}</span>
                  </div>
                ))}
              </div>
              {isBettor && <RiskDisclosure strategyType={strategyType} />}
            </motion.div>
          )}

          {/* ── In progress ────────────────────────────────────────────── */}
          {isProcessing && (
            <motion.div
              key="progress"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-6 space-y-5"
            >
              {([
                { label: 'Create portfolio + transfer PolicyCap', done: step !== 'deploying', active: step === 'deploying' },
                { label: 'Deposit DUSDC', done: step === 'enabling' || step === 'registering', active: step === 'depositing' },
                ...(needsKeeperSetup ? [{ label: 'Enable strategy on-chain (keeper)', done: step === 'registering', active: step === 'enabling' }] : []),
                { label: 'Register with keeper', done: false, active: step === 'registering' },
              ] as Array<{ label: string; done: boolean; active: boolean }>).map(({ label, done, active }) => (
                <div key={label} className="flex items-center gap-3">
                  {done
                    ? <CheckCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--status-green)' }} />
                    : active
                    ? <Loader className="w-4 h-4 shrink-0 animate-spin" style={{ color: 'var(--accent)' }} />
                    : <div className="w-4 h-4 shrink-0 rounded-full border" style={{ borderColor: 'var(--line-strong)' }} />
                  }
                  <span className="text-sm" style={{ color: active ? 'var(--ink-primary)' : done ? 'var(--ink-secondary)' : 'var(--ink-muted)' }}>
                    {label}
                  </span>
                </div>
              ))}
              {statusMsg && (
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>{statusMsg}</p>
              )}
            </motion.div>
          )}

          {/* ── Done ───────────────────────────────────────────────────── */}
          {step === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-6 text-center space-y-4"
            >
              <CheckCircle className="w-10 h-10 mx-auto" style={{ color: 'var(--status-green)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--ink-primary)' }}>Portfolio deployed!</p>
                <p className="text-sm mt-1" style={{ color: 'var(--ink-secondary)' }}>
                  The keeper will act on the next oracle expiry automatically.
                </p>
              </div>
              <div className="flex flex-col gap-1.5 items-center">
                {tx1Digest && (
                  <a
                    href={txUrl(tx1Digest)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Create TX <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {tx2Digest && (
                  <a
                    href={txUrl(tx2Digest)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Deposit TX <ExternalLink className="w-3 h-3" />
                  </a>
                )}
                {setupTxDigest && (
                  <a
                    href={txUrl(setupTxDigest)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs hover:underline"
                    style={{ color: 'var(--accent)' }}
                  >
                    Strategy Enable TX <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Error ──────────────────────────────────────────────────── */}
          {step === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-4 space-y-3"
            >
              <div className="flex items-start gap-2 rounded-lg px-4 py-3" style={{ background: 'rgba(240,68,56,0.08)', border: '1px solid rgba(240,68,56,0.2)' }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--status-red)' }} />
                <p className="text-sm" style={{ color: 'var(--status-red)' }}>{errorMsg}</p>
              </div>
              {tx1Digest && (
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Portfolio was created (TX:{' '}
                  <a href={txUrl(tx1Digest)} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>
                    {tx1Digest.slice(0, 12)}…
                  </a>
                  ) but deposit/registration failed. Contact support with this TX digest.
                </p>
              )}
            </motion.div>
          )}

        </AnimatePresence>

        <DialogFooter>
          {step === 'done' ? (
            <Button onClick={handleClose}>Close</Button>
          ) : step === 'error' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Close</Button>
              <Button onClick={() => { setStep('confirm'); setErrorMsg('') }}>Retry</Button>
            </>
          ) : step === 'config' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button onClick={() => setStep('confirm')} disabled={!config.initialDeposit || parseFloat(config.initialDeposit) < 1}>
                Review <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : step === 'confirm' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button variant="outline" onClick={() => setStep('config')}>Back</Button>
              <Button onClick={handleDeploy} disabled={!chainConfig?.keeperAddress || !account}>
                {!account ? 'Connect wallet first' : 'Deploy Strategy'}
              </Button>
            </>
          ) : null /* isProcessing — no buttons */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
