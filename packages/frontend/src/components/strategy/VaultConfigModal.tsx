/**
 * VaultConfigModal — deploy a named bot (VaultConfig) with 1 or 2 strategy slots.
 *
 * Flow:
 *   setup → config1 → [config2] → confirm
 *   → deploying1 → depositing1 → [deploying2] → [depositing2] → registering → done
 *
 * Each strategy slot gets its own portfolio on-chain. Both portfolios are grouped
 * into a VaultConfig (the "named bot") that appears on the leaderboard and supports
 * copy trading.
 */

import { useState, useCallback, useEffect } from 'react'
import { ArrowRight, ArrowLeft, CheckCircle, Loader, AlertCircle, ExternalLink, Plus, X, Lock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { bcs } from '@mysten/sui/bcs'
import { useQueryClient } from '@tanstack/react-query'
import { encryptAndUpload, type SealVaultConfig } from '@/lib/seal'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { RiskDisclosure } from '@/components/common/RiskDisclosure'
import {
  STRATEGY_NAMES, STRATEGY_COLORS, BETTOR_STRATEGIES, HOUSE_STRATEGIES,
} from '@/lib/constants'
import { useChainConfig } from '@/hooks/useChainConfig'
import { api } from '@/lib/api'
import { txUrl } from '@/lib/sui'
import { cn } from '@/lib/cn'

// ── Constants ─────────────────────────────────────────────────────────────────

const DUSDC_DECIMALS = 6
const ALL_STRATEGY_TYPES = [0, 1, 2, 3, 4, 5, 6, 7]
const ALLOCATION_PRESETS = [
  { label: '100%', bps: 10000 },
  { label: '70 / 30', bps: 7000 },
  { label: '60 / 40', bps: 6000 },
  { label: '50 / 50', bps: 5000 },
]

// strategy number → DB string key
const STRATEGY_ID: Record<number, string> = {
  0: 'PLP_SUPPLIER', 1: 'HEDGED_PLP', 2: 'SMART_VAULT', 3: 'PRINCIPAL_PROTECTED',
  4: 'RANGE_ROLL',   5: 'VOL_TARGETED_RANGE', 6: 'CROSS_VENUE_ARB', 7: 'MARGIN_LOOP',
}

function toRaw(dusdc: string): bigint {
  const n = parseFloat(dusdc)
  if (!isFinite(n) || n < 0) return 0n
  return BigInt(Math.round(n * 10 ** DUSDC_DECIMALS))
}

// ── Slot config type ──────────────────────────────────────────────────────────

interface SlotConfig {
  utilTarget: string
  strikeSelection: string
  liquidityReservePct: string
  drawdownPauseThresholdPct: string
  volTargetBps: string
  hedgeMultiplier: string
}

const DEFAULT_CONFIG: SlotConfig = {
  utilTarget: '0.25',
  strikeSelection: 'ATM',
  liquidityReservePct: '0.10',
  drawdownPauseThresholdPct: '0.15',
  volTargetBps: '2000',
  hedgeMultiplier: '1.0',
}

// ── Deployed slot state ───────────────────────────────────────────────────────

interface DeployedSlot {
  portfolioId: string
  policyCapId: string
  depositRaw: bigint
  txCreate: string
  txDeposit: string
}

// ── Step type ─────────────────────────────────────────────────────────────────

type Step =
  | 'setup' | 'config1' | 'config2' | 'confirm'
  | 'deploying1' | 'depositing1' | 'deploying2' | 'depositing2'
  | 'registering' | 'sealing' | 'done' | 'error'

// ── Props ─────────────────────────────────────────────────────────────────────

interface VaultConfigModalProps {
  defaultStrategyType?: number
  defaultConfig1?: Partial<SlotConfig>
  open: boolean
  onClose: () => void
}

// ── Strategy picker ───────────────────────────────────────────────────────────

function StrategyPicker({
  value,
  onChange,
  exclude,
}: {
  value: number
  onChange: (v: number) => void
  exclude?: number
}) {
  return (
    <div className="grid grid-cols-4 gap-1.5">
      {ALL_STRATEGY_TYPES.map((t) => {
        const color = STRATEGY_COLORS[t]
        const isSelected = value === t
        const isExcluded = exclude === t
        return (
          <button
            key={t}
            type="button"
            disabled={isExcluded}
            onClick={() => onChange(t)}
            className={cn(
              'rounded-lg px-2 py-2 text-center transition-all border text-[9px] font-bold uppercase tracking-wider leading-tight',
              isSelected
                ? 'border-[var(--accent)] bg-[rgba(169,168,236,0.12)] text-white'
                : 'border-[rgba(255,255,255,0.07)] text-[#58586A] hover:border-[rgba(169,168,236,0.3)] hover:text-white',
              isExcluded && 'opacity-30 cursor-not-allowed',
            )}
            style={isSelected ? { borderColor: color, background: `${color}18`, color } : undefined}
          >
            <span className="text-[8px] opacity-60 block">{String(t).padStart(2, '0')}</span>
            {STRATEGY_NAMES[t]?.split(' ').map((w, i) => <span key={i} className="block">{w}</span>)}
          </button>
        )
      })}
    </div>
  )
}

// ── Per-slot config form ──────────────────────────────────────────────────────

function SlotConfigForm({
  strategyType,
  config,
  onChange,
}: {
  strategyType: number
  config: SlotConfig
  onChange: (patch: Partial<SlotConfig>) => void
}) {
  const isBettor  = BETTOR_STRATEGIES.has(strategyType)
  const isHedged  = strategyType === 1
  const isVolTgt  = strategyType === 5

  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs">Utilization Target</Label>
        <Select value={config.utilTarget} onValueChange={(v) => onChange({ utilTarget: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0.05">5% — conservative</SelectItem>
            <SelectItem value="0.10">10%</SelectItem>
            <SelectItem value="0.25">25% — balanced</SelectItem>
            <SelectItem value="0.50">50%</SelectItem>
            <SelectItem value="0.75">75% — aggressive</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Liquidity Reserve</Label>
        <Select value={config.liquidityReservePct} onValueChange={(v) => onChange({ liquidityReservePct: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0.05">5%</SelectItem>
            <SelectItem value="0.10">10%</SelectItem>
            <SelectItem value="0.20">20%</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs">Drawdown Pause</Label>
        <Select value={config.drawdownPauseThresholdPct} onValueChange={(v) => onChange({ drawdownPauseThresholdPct: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="0">Disabled</SelectItem>
            <SelectItem value="0.10">10%</SelectItem>
            <SelectItem value="0.15">15% — recommended</SelectItem>
            <SelectItem value="0.20">20%</SelectItem>
            <SelectItem value="0.30">30%</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isHedged && (
        <div className="space-y-1.5">
          <Label className="text-xs">Hedge Multiplier</Label>
          <Select value={config.hedgeMultiplier} onValueChange={(v) => onChange({ hedgeMultiplier: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0.5">0.5× — partial</SelectItem>
              <SelectItem value="1.0">1.0× — full</SelectItem>
              <SelectItem value="1.5">1.5× — over-hedge</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isBettor && (
        <div className="space-y-1.5">
          <Label className="text-xs">Strike Selection</Label>
          <Select value={config.strikeSelection} onValueChange={(v) => onChange({ strikeSelection: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ATM">ATM</SelectItem>
              <SelectItem value="OTM_1">OTM +1</SelectItem>
              <SelectItem value="OTM_2">OTM +2</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isVolTgt && (
        <div className="space-y-1.5">
          <Label className="text-xs">Vol Target</Label>
          <Select value={config.volTargetBps} onValueChange={(v) => onChange({ volTargetBps: v })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="1500">15%</SelectItem>
              <SelectItem value="2000">20% — balanced</SelectItem>
              <SelectItem value="3000">30%</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}

// ── Progress dots ─────────────────────────────────────────────────────────────

function StepDots({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div className="flex items-center gap-1.5 mb-1">
      {steps.map((label, i) => (
        <div key={label} className="flex items-center gap-1.5">
          <div
            className={cn(
              'w-1.5 h-1.5 rounded-full transition-all',
              i < current ? 'bg-[var(--accent)] opacity-40' : i === current ? 'bg-[var(--accent)] w-4' : 'bg-[rgba(255,255,255,0.12)]',
            )}
          />
          {i === current && (
            <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: 'var(--accent)' }}>
              {label}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function VaultConfigModal({ defaultStrategyType = 0, defaultConfig1, open, onClose }: VaultConfigModalProps) {
  // ── Modal-level state ──────────────────────────────────────────────────────
  const [botName, setBotName]           = useState('')
  const [totalDeposit, setTotalDeposit] = useState('200')
  const [isPublic, setIsPublic]         = useState(true)
  const [copyFee, setCopyFee]           = useState('')        // DUSDC, empty = free
  const [strategy1, setStrategy1]       = useState(defaultStrategyType)
  const [config1, setConfig1]           = useState<SlotConfig>({ ...DEFAULT_CONFIG })
  const [hasSecond, setHasSecond]       = useState(false)
  const [strategy2, setStrategy2]       = useState(1)       // default second strategy
  const [config2, setConfig2]           = useState<SlotConfig>({ ...DEFAULT_CONFIG })
  const [alloc1Bps, setAlloc1Bps]       = useState(10000)   // 10000 = 100% to slot 1

  const [step, setStep]         = useState<Step>('setup')
  const [statusMsg, setStatusMsg] = useState('')
  const [errorMsg, setErrorMsg]   = useState('')

  // Track deployed slots as we go (populated during TX steps)
  const [slot1, setSlot1] = useState<DeployedSlot | null>(null)
  const [slot2, setSlot2] = useState<DeployedSlot | null>(null)

  // Sync strategy1 + prefill config1 when the modal opens
  useEffect(() => {
    if (open) {
      setStrategy1(defaultStrategyType)
      if (defaultConfig1) setConfig1(c => ({ ...c, ...defaultConfig1 }))
    }
  }, [open, defaultStrategyType, defaultConfig1])

  // ── Hooks ─────────────────────────────────────────────────────────────────
  const account   = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const { data: chainConfig } = useChainConfig()
  const qc = useQueryClient()

  // ── Derived ───────────────────────────────────────────────────────────────
  const alloc2Bps      = 10000 - alloc1Bps
  const totalRaw       = toRaw(totalDeposit)
  const deposit1Raw    = BigInt(Math.floor(Number(totalRaw) * alloc1Bps / 10000))
  const deposit2Raw    = BigInt(Math.floor(Number(totalRaw) * alloc2Bps / 10000))
  const budgetCapRaw   = totalRaw * 500n  // ~2000 cycles before refresh needed
  const expiryMs       = BigInt(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const isProcessing   = ['deploying1', 'depositing1', 'deploying2', 'depositing2', 'registering', 'sealing'].includes(step)

  const uiSteps = hasSecond
    ? ['Setup', 'Strategy 1', 'Strategy 2', 'Confirm']
    : ['Setup', 'Strategy', 'Confirm']

  const uiStepIndex: Record<Step, number> = hasSecond
    ? { setup: 0, config1: 1, config2: 2, confirm: 3, deploying1: 3, depositing1: 3, deploying2: 3, depositing2: 3, registering: 3, sealing: 3, done: 3, error: 3 }
    : { setup: 0, config1: 1, config2: 1, confirm: 2, deploying1: 2, depositing1: 2, deploying2: 2, depositing2: 2, registering: 2, sealing: 2, done: 2, error: 2 }

  // ── Helpers ───────────────────────────────────────────────────────────────

  const handleClose = () => {
    if (isProcessing) return
    setStep('setup')
    setSlot1(null)
    setSlot2(null)
    setErrorMsg('')
    setStatusMsg('')
    setCopyFee('')
    onClose()
  }

  const extractObjects = async (digest: string) => {
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
  }

  const deploySlot = useCallback(async (
    depositRaw: bigint,
    onProgress: (msg: string) => void,
  ): Promise<{ portfolioId: string; policyCapId: string; txCreate: string; txDeposit: string }> => {
    if (!account || !chainConfig) throw new Error('Wallet or chain config unavailable')
    const userAddress = account.address
    const PKG   = chainConfig.sonarkPackage
    const DUSDC = chainConfig.dusdcType
    const CLOCK = chainConfig.clockId
    const KEEPER = chainConfig.keeperAddress!

    // TX 1: create portfolio + transfer PolicyCap to keeper
    onProgress('Creating portfolio on-chain…')
    const tx1 = new Transaction()
    const policyCap = tx1.moveCall({
      target: `${PKG}::portfolio::create`,
      typeArguments: [DUSDC],
      arguments: [tx1.pure.u64(budgetCapRaw), tx1.pure.u64(expiryMs), tx1.object(CLOCK)],
    })
    tx1.transferObjects([policyCap], KEEPER)
    const res1 = await signAndExecute({ transaction: tx1 })
    onProgress('Fetching created objects…')
    const { portfolioId, policyCapId } = await extractObjects(res1.digest)

    // TX 2: deposit DUSDC into portfolio
    onProgress(`Depositing DUSDC…`)
    const coins = await suiClient.getCoins({ owner: userAddress, coinType: DUSDC })
    const coin  = coins.data.find((c) => BigInt(c.balance) >= depositRaw)
    if (!coin) throw new Error(`Insufficient DUSDC. Need ${Number(depositRaw) / 1e6} DUSDC.`)

    const tx2 = new Transaction()
    const [split] = tx2.splitCoins(tx2.object(coin.coinObjectId), [tx2.pure.u64(depositRaw)])
    const share = tx2.moveCall({
      target: `${PKG}::portfolio::deposit`,
      typeArguments: [DUSDC],
      arguments: [tx2.object(portfolioId), split, tx2.object(CLOCK)],
    })
    tx2.transferObjects([share], userAddress)
    const res2 = await signAndExecute({ transaction: tx2 })

    return { portfolioId, policyCapId, txCreate: res1.digest, txDeposit: res2.digest }
  }, [account, chainConfig, budgetCapRaw, expiryMs, signAndExecute, suiClient])

  // ── Main deploy handler ────────────────────────────────────────────────────

  const handleDeploy = useCallback(async () => {
    if (!account || !chainConfig?.keeperAddress || !chainConfig.sonarkPackage) {
      setErrorMsg('Wallet not connected or chain config unavailable.')
      setStep('error')
      return
    }

    const userAddress = account.address
    const isBettor1 = BETTOR_STRATEGIES.has(strategy1)
    const isBettor2 = BETTOR_STRATEGIES.has(strategy2)

    try {
      // ── Deploy slot 1 ─────────────────────────────────────────────────────
      setStep('deploying1')
      const d1 = await deploySlot(deposit1Raw, (msg) => setStatusMsg(msg))
      setSlot1({ ...d1, depositRaw: deposit1Raw })
      setStep('depositing1')

      // ── Deploy slot 2 (if dual strategy) ──────────────────────────────────
      let d2: typeof d1 | null = null
      if (hasSecond) {
        setStep('deploying2')
        d2 = await deploySlot(deposit2Raw, (msg) => setStatusMsg(msg))
        setSlot2({ ...d2, depositRaw: deposit2Raw })
        setStep('depositing2')
      }

      // ── Register portfolios + VaultConfig with backend ────────────────────
      setStep('registering')
      setStatusMsg('Registering portfolios with keeper…')

      await api.portfolios.create({
        object_id:       d1.portfolioId,
        policy_cap_id:   d1.policyCapId,
        owner_address:   userAddress,
        strategy_type:   strategy1,
        name:            botName ? `${botName} #1` : undefined,
        initial_deposit_raw: deposit1Raw.toString(),
        util_target:     parseFloat(config1.utilTarget),
        strike_selection: isBettor1 ? config1.strikeSelection : 'ATM',
        liquidity_reserve_pct: parseFloat(config1.liquidityReservePct),
        drawdown_pause_threshold_pct: config1.drawdownPauseThresholdPct !== '0'
          ? parseFloat(config1.drawdownPauseThresholdPct) : null,
        vol_target_bps: strategy1 === 5 ? parseInt(config1.volTargetBps) : null,
        hedge_multiplier: strategy1 === 1 ? parseFloat(config1.hedgeMultiplier) : undefined,
      })

      const portfolioIds = [d1.portfolioId]
      const allocations: Array<{ strategy: string; allocationBps: number }> = [
        { strategy: STRATEGY_ID[strategy1]!, allocationBps: alloc1Bps },
      ]

      if (hasSecond && d2) {
        await api.portfolios.create({
          object_id:       d2.portfolioId,
          policy_cap_id:   d2.policyCapId,
          owner_address:   userAddress,
          strategy_type:   strategy2,
          name:            botName ? `${botName} #2` : undefined,
          initial_deposit_raw: deposit2Raw.toString(),
          util_target:     parseFloat(config2.utilTarget),
          strike_selection: isBettor2 ? config2.strikeSelection : 'ATM',
          liquidity_reserve_pct: parseFloat(config2.liquidityReservePct),
          drawdown_pause_threshold_pct: config2.drawdownPauseThresholdPct !== '0'
            ? parseFloat(config2.drawdownPauseThresholdPct) : null,
          vol_target_bps: strategy2 === 5 ? parseInt(config2.volTargetBps) : null,
          hedge_multiplier: strategy2 === 1 ? parseFloat(config2.hedgeMultiplier) : undefined,
        })
        portfolioIds.push(d2.portfolioId)
        allocations.push({ strategy: STRATEGY_ID[strategy2]!, allocationBps: alloc2Bps })
      }

      setStatusMsg('Creating named bot…')
      // Private vaults: fee is mandatory (enforced in UI); public vaults: no fee (Seal-only enforcement)
      const copyFeeRawStr = !isPublic && copyFee && parseFloat(copyFee) > 0
        ? String(Math.round(parseFloat(copyFee) * 1e6))
        : undefined
      const vcResult = await api.vaultConfigs.create({
        name:            botName || STRATEGY_NAMES[strategy1]!,
        creator_address: userAddress,
        portfolio_ids:   portfolioIds,
        allocations,
        is_public:       isPublic,
        copy_fee_raw:    copyFeeRawStr,
      })
      const vaultConfigId = vcResult.vault_config_id

      // ── Seal encrypt (private vaults only) ─────────────────────────────────
      if (!isPublic && copyFeeRawStr) {
        setStep('sealing')

        setStatusMsg('Encrypting config with Seal…')
        const sealConfig: SealVaultConfig = {
          name: botName || STRATEGY_NAMES[strategy1]!,
          allocations: [
            {
              strategy:                   STRATEGY_ID[strategy1]!,
              strategyType:               strategy1,
              allocationBps:              alloc1Bps,
              utilTarget:                 parseFloat(config1.utilTarget),
              strikeSelection:            config1.strikeSelection,
              liquidityReservePct:        parseFloat(config1.liquidityReservePct),
              drawdownPauseThresholdPct:  config1.drawdownPauseThresholdPct !== '0'
                ? parseFloat(config1.drawdownPauseThresholdPct) : null,
              volTargetBps:               strategy1 === 5 ? parseInt(config1.volTargetBps) : null,
              hedgeMultiplier:            strategy1 === 1 ? parseFloat(config1.hedgeMultiplier) : 1.0,
            },
            ...(hasSecond ? [{
              strategy:                   STRATEGY_ID[strategy2]!,
              strategyType:               strategy2,
              allocationBps:              alloc2Bps,
              utilTarget:                 parseFloat(config2.utilTarget),
              strikeSelection:            config2.strikeSelection,
              liquidityReservePct:        parseFloat(config2.liquidityReservePct),
              drawdownPauseThresholdPct:  config2.drawdownPauseThresholdPct !== '0'
                ? parseFloat(config2.drawdownPauseThresholdPct) : null,
              volTargetBps:               strategy2 === 5 ? parseInt(config2.volTargetBps) : null,
              hedgeMultiplier:            strategy2 === 1 ? parseFloat(config2.hedgeMultiplier) : 1.0,
            }] : []),
          ],
        }

        const { blobId, blobIdBytes } = await encryptAndUpload(
          suiClient,
          chainConfig.sealKeyServerIds ?? [],
          chainConfig.sonarkPackage,
          d1.portfolioId,
          sealConfig,
          chainConfig.walrusPublisherUrl,
        )

        // Set copy config on-chain: stores blobId + fee, gates future decrypt
        // In Move, Option<u64> is encoded as vector<u64> with 0 or 1 elements.
        setStatusMsg('Setting copy config on-chain…')
        const feeOptBytes = bcs.vector(bcs.u64()).serialize([BigInt(copyFeeRawStr)])
        const sealTx = new Transaction()
        sealTx.moveCall({
          target: `${chainConfig.sonarkPackage}::portfolio::set_copy_config`,
          typeArguments: [chainConfig.dusdcType],
          arguments: [
            sealTx.object(d1.portfolioId),
            sealTx.pure.vector('u8', blobIdBytes),
            sealTx.pure(feeOptBytes),
          ],
        })
        await signAndExecute({ transaction: sealTx })

        // Persist blobId in DB so the leaderboard/copy UI knows this vault is sealed
        setStatusMsg('Saving Seal config…')
        await api.vaultConfigs.patch(vaultConfigId, { seal_blob_id: blobId })
      }

      void qc.invalidateQueries({ queryKey: ['portfolios'] })
      setStep('done')
      setStatusMsg('Your bot is live — the keeper will act on the next expiry.')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }, [
    account, chainConfig, botName, isPublic, copyFee,
    strategy1, config1, strategy2, config2,
    hasSecond, alloc1Bps, alloc2Bps, deposit1Raw, deposit2Raw,
    deploySlot, qc,
  ])

  // ── Progress tracker items ─────────────────────────────────────────────────

  const afterReg = ['sealing', 'done']
  const progressItems = [
    { label: 'Create portfolio 1 + PolicyCap', done: step !== 'deploying1' && step !== 'setup' && step !== 'config1' && step !== 'config2' && step !== 'confirm', active: step === 'deploying1' },
    { label: `Deposit ${(Number(deposit1Raw) / 1e6).toFixed(0)} DUSDC into portfolio 1`, done: ['deploying2', 'depositing2', 'registering', ...afterReg].includes(step) || (!hasSecond && (afterReg.includes(step) || step === 'registering')), active: step === 'depositing1' },
    ...(hasSecond ? [
      { label: 'Create portfolio 2 + PolicyCap', done: ['depositing2', 'registering', ...afterReg].includes(step), active: step === 'deploying2' },
      { label: `Deposit ${(Number(deposit2Raw) / 1e6).toFixed(0)} DUSDC into portfolio 2`, done: ['registering', ...afterReg].includes(step), active: step === 'depositing2' },
    ] : []),
    { label: 'Register with keeper + create named bot', done: afterReg.includes(step) || step === 'done', active: step === 'registering' },
    ...(!isPublic ? [
      { label: 'Encrypt config with Seal + set on-chain', done: step === 'done', active: step === 'sealing' },
    ] : []),
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="gradient-text">Deploy Named Bot</DialogTitle>
          <DialogDescription>
            Configure your bot's strategy mix. The keeper will run it autonomously on every ~2h expiry.
          </DialogDescription>
          {!isProcessing && step !== 'done' && step !== 'error' && (
            <StepDots steps={uiSteps} current={uiStepIndex[step]} />
          )}
        </DialogHeader>

        <AnimatePresence mode="wait">

          {/* ── Setup ───────────────────────────────────────────────────── */}
          {step === 'setup' && (
            <motion.div key="setup" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="space-y-5">

              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2 space-y-1.5">
                  <Label>Bot Name</Label>
                  <Input
                    placeholder={`My ${STRATEGY_NAMES[strategy1]} Bot`}
                    value={botName}
                    onChange={(e) => setBotName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Total Deposit (DUSDC)</Label>
                  <Input
                    type="number" min="1"
                    value={totalDeposit}
                    onChange={(e) => setTotalDeposit(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Visibility</Label>
                  <Select value={isPublic ? 'public' : 'private'} onValueChange={(v) => setIsPublic(v === 'public')}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="public">Public — on leaderboard</SelectItem>
                      <SelectItem value="private">Private — hidden</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {!isPublic && (
                  <div className="col-span-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <Lock className="w-3 h-3" style={{ color: '#A9A8EC' }} />
                      <Label className="text-xs">Copy Fee (DUSDC) <span className="text-[#F04438]">*required</span></Label>
                    </div>
                    <Input
                      type="number" min="0.01" step="0.1"
                      placeholder="e.g. 5"
                      value={copyFee}
                      onChange={(e) => setCopyFee(e.target.value)}
                    />
                    <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>
                      Config is Seal-encrypted. Copiers pay this fee to decrypt and deploy. Must be &gt; 0.
                    </p>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label>Strategy</Label>
                <StrategyPicker value={strategy1} onChange={setStrategy1} exclude={hasSecond ? strategy2 : undefined} />
              </div>

              {/* Second strategy toggle */}
              <div>
                {!hasSecond ? (
                  <button
                    type="button"
                    onClick={() => { setHasSecond(true); setStrategy2(strategy1 === 1 ? 0 : 1) }}
                    className="flex items-center gap-2 text-xs font-semibold text-[#A9A8EC] hover:text-white transition-colors rounded-lg border border-dashed border-[rgba(169,168,236,0.25)] px-3 py-2 w-full justify-center"
                  >
                    <Plus className="w-3 h-3" /> Add second strategy (optional)
                  </button>
                ) : (
                  <div className="space-y-2 rounded-lg border border-[rgba(169,168,236,0.2)] bg-[rgba(169,168,236,0.04)] p-3">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-[#A9A8EC]">Second Strategy</Label>
                      <button type="button" onClick={() => setHasSecond(false)} className="text-[#58586A] hover:text-white transition-colors">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    <StrategyPicker value={strategy2} onChange={setStrategy2} exclude={strategy1} />
                    <div className="space-y-1.5 pt-1">
                      <Label className="text-xs">Allocation Split</Label>
                      <div className="flex gap-2">
                        {ALLOCATION_PRESETS.map((p) => (
                          <button
                            key={p.bps}
                            type="button"
                            onClick={() => setAlloc1Bps(p.bps)}
                            className={cn(
                              'flex-1 rounded-md py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all',
                              alloc1Bps === p.bps
                                ? 'border-[var(--accent)] bg-[rgba(169,168,236,0.12)] text-white'
                                : 'border-[rgba(255,255,255,0.08)] text-[#58586A] hover:border-[rgba(169,168,236,0.3)] hover:text-white',
                            )}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[10px] text-[#58586A]">
                        {(alloc1Bps / 100).toFixed(0)}% → {STRATEGY_NAMES[strategy1]} ·{' '}
                        {(alloc2Bps / 100).toFixed(0)}% → {STRATEGY_NAMES[strategy2]}
                        {' '}({(Number(deposit1Raw) / 1e6).toFixed(0)} + {(Number(deposit2Raw) / 1e6).toFixed(0)} DUSDC)
                      </p>
                    </div>
                  </div>
                )}
              </div>

            </motion.div>
          )}

          {/* ── Config 1 ────────────────────────────────────────────────── */}
          {step === 'config1' && (
            <motion.div key="config1" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: STRATEGY_COLORS[strategy1] }}>
                  {STRATEGY_NAMES[strategy1]}
                </span>
                {hasSecond && <span className="text-[10px] text-[#58586A]">{(alloc1Bps / 100).toFixed(0)}% — {(Number(deposit1Raw) / 1e6).toFixed(0)} DUSDC</span>}
              </div>
              <SlotConfigForm strategyType={strategy1} config={config1} onChange={(p) => setConfig1((c) => ({ ...c, ...p }))} />
              {BETTOR_STRATEGIES.has(strategy1) && <RiskDisclosure strategyType={strategy1} />}
            </motion.div>
          )}

          {/* ── Config 2 ────────────────────────────────────────────────── */}
          {step === 'config2' && (
            <motion.div key="config2" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }} className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-widest" style={{ color: STRATEGY_COLORS[strategy2] }}>
                  {STRATEGY_NAMES[strategy2]}
                </span>
                <span className="text-[10px] text-[#58586A]">{(alloc2Bps / 100).toFixed(0)}% — {(Number(deposit2Raw) / 1e6).toFixed(0)} DUSDC</span>
              </div>
              <SlotConfigForm strategyType={strategy2} config={config2} onChange={(p) => setConfig2((c) => ({ ...c, ...p }))} />
              {BETTOR_STRATEGIES.has(strategy2) && <RiskDisclosure strategyType={strategy2} />}
            </motion.div>
          )}

          {/* ── Confirm ─────────────────────────────────────────────────── */}
          {step === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="space-y-3">
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                {!isPublic
                  ? `${hasSecond ? '5' : '3'} wallet signatures required (deploy + 1 Seal TX).`
                  : `${hasSecond ? '4' : '2'} wallet signatures required to deploy this bot.`
                }
              </p>
              <div className="rounded-lg divide-y" style={{ border: '1px solid var(--line)', background: 'var(--bg-inset)' }}>
                {[
                  ['Name', botName || `${STRATEGY_NAMES[strategy1]} Bot`],
                  ['Visibility', isPublic ? 'Public (leaderboard)' : 'Private — Seal-encrypted'],
                  ...(!isPublic ? [['Copy Fee (mandatory)', `${copyFee} DUSDC`]] : []),
                  ['Total Deposit', `${totalDeposit} DUSDC`],
                  ['Strategy 1', `${STRATEGY_NAMES[strategy1]} — ${(Number(deposit1Raw) / 1e6).toFixed(0)} DUSDC (${(alloc1Bps / 100).toFixed(0)}%)`],
                  ...(hasSecond ? [['Strategy 2', `${STRATEGY_NAMES[strategy2]} — ${(Number(deposit2Raw) / 1e6).toFixed(0)} DUSDC (${(alloc2Bps / 100).toFixed(0)}%)`]] : []),
                  ['PolicyCap budget', `${(parseFloat(totalDeposit) * 0.5).toFixed(0)} DUSDC / lifetime`],
                  ['PolicyCap expiry', '30 days'],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
                    <span style={{ color: 'var(--ink-muted)' }}>{k}</span>
                    <span className="font-medium text-right max-w-[55%]" style={{ color: 'var(--ink-primary)' }}>{v}</span>
                  </div>
                ))}
              </div>
              {(BETTOR_STRATEGIES.has(strategy1) || (hasSecond && BETTOR_STRATEGIES.has(strategy2))) && (
                <p className="text-xs text-[#E8A627] bg-[rgba(232,166,39,0.06)] border border-[rgba(232,166,39,0.15)] rounded-lg px-3 py-2">
                  This bot includes a short-volatility strategy. Profitable in calm markets; loses in volatility spikes.
                </p>
              )}
            </motion.div>
          )}

          {/* ── In progress ─────────────────────────────────────────────── */}
          {isProcessing && (
            <motion.div key="progress" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4 space-y-4">
              {progressItems.map(({ label, done, active }) => (
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
              {statusMsg && <p className="text-xs pl-7" style={{ color: 'var(--ink-muted)' }}>{statusMsg}</p>}
            </motion.div>
          )}

          {/* ── Done ────────────────────────────────────────────────────── */}
          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="py-6 text-center space-y-4">
              <CheckCircle className="w-10 h-10 mx-auto" style={{ color: 'var(--status-green)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--ink-primary)' }}>
                  {botName || 'Bot'} is live!
                </p>
                <p className="text-sm mt-1" style={{ color: 'var(--ink-secondary)' }}>
                  The keeper will execute your strategy on the next oracle expiry.
                </p>
              </div>
              <div className="flex flex-col gap-1 items-center">
                {[slot1?.txCreate, slot1?.txDeposit, slot2?.txCreate, slot2?.txDeposit].filter(Boolean).map((d, i) => (
                  <a key={i} href={txUrl(d!)} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs hover:underline" style={{ color: 'var(--accent)' }}>
                    TX {i + 1} <ExternalLink className="w-3 h-3" />
                  </a>
                ))}
              </div>
            </motion.div>
          )}

          {/* ── Error ───────────────────────────────────────────────────── */}
          {step === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4 space-y-3">
              <div className="flex items-start gap-2 rounded-lg px-4 py-3" style={{ background: 'rgba(240,68,56,0.08)', border: '1px solid rgba(240,68,56,0.2)' }}>
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--status-red)' }} />
                <p className="text-sm" style={{ color: 'var(--status-red)' }}>{errorMsg}</p>
              </div>
              {slot1 && (
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Portfolio 1 was created ({slot1.portfolioId.slice(0, 10)}…). Contact support if the issue persists.
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
          ) : step === 'setup' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button
                onClick={() => setStep('config1')}
                disabled={
                  parseFloat(totalDeposit) < 1 ||
                  (!isPublic && (!(copyFee) || parseFloat(copyFee) <= 0))
                }
              >
                Next <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : step === 'config1' ? (
            <>
              <Button variant="outline" onClick={() => setStep('setup')}>
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
              <Button onClick={() => setStep(hasSecond ? 'config2' : 'confirm')}>
                Next <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : step === 'config2' ? (
            <>
              <Button variant="outline" onClick={() => setStep('config1')}>
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
              <Button onClick={() => setStep('confirm')}>
                Next <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            </>
          ) : step === 'confirm' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button variant="outline" onClick={() => setStep(hasSecond ? 'config2' : 'config1')}>
                <ArrowLeft className="w-3.5 h-3.5" /> Back
              </Button>
              <Button onClick={handleDeploy} disabled={!chainConfig?.keeperAddress || !account}>
                {!account ? 'Connect wallet' : 'Deploy Bot'}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
