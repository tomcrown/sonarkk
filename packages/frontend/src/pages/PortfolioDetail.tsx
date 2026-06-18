import { useState, useCallback, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  ArrowLeft, Settings, TrendingUp, Activity, Clock, DollarSign,
  LogOut, CheckCircle, Loader, AlertCircle, ExternalLink, Pause, Play, RefreshCw, type LucideIcon,
} from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useCurrentAccount, useSignAndExecuteTransaction, useSuiClient } from '@mysten/dapp-kit'
import { Transaction } from '@mysten/sui/transactions'
import { usePortfolioDetail } from '@/hooks/usePortfolios'
import { usePatchPortfolio } from '@/hooks/usePortfolios'
import { useChainConfig } from '@/hooks/useChainConfig'
import { NavChart } from '@/components/portfolio/NavChart'
import { CycleTable } from '@/components/portfolio/CycleTable'
import { RiskDisclosure } from '@/components/common/RiskDisclosure'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { BracketCard } from '@/components/common/BracketCard'
import { StatCard } from '@/components/common/StatCard'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { formatDusdc, formatNav, formatPct, formatApy, formatDateTime } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'
import { txUrl } from '@/lib/sui'

// ── ConfigModal ────────────────────────────────────────────────────────────────

function ConfigModal({
  open,
  onClose,
  portfolioId,
  currentConfig,
}: {
  open: boolean
  onClose: () => void
  portfolioId: string
  currentConfig: Record<string, unknown>
}) {
  const { mutate, isPending } = usePatchPortfolio(portfolioId)
  const [name, setName] = useState(currentConfig.name as string ?? '')

  function handleSave() {
    mutate({ name }, { onSuccess: onClose })
  }

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Portfolio Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="pname">Portfolio Name</Label>
            <Input
              id="pname"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1"
              placeholder="My Strategy Vault"
            />
          </div>
          <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
            Additional parameters (ATM vol threshold, max position size) are set at deploy time and governed by the on-chain policy object. Contact the keeper admin to modify them.
          </p>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={isPending}>
            {isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── WithdrawModal ──────────────────────────────────────────────────────────────

type WithdrawStep = 'preview' | 'withdrawing' | 'done' | 'error'

interface PortfolioShareObject {
  objectId: string
  navPerShare: bigint
}

function WithdrawModal({
  open,
  onClose,
  portfolioObjectId,
  navPerShareRaw,
}: {
  open: boolean
  onClose: () => void
  portfolioObjectId: string
  navPerShareRaw: string
}) {
  const [step, setStep] = useState<WithdrawStep>('preview')
  const [shares, setShares] = useState<PortfolioShareObject[]>([])
  const [loadingShares, setLoadingShares] = useState(false)
  const [txDigest, setTxDigest] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const account = useCurrentAccount()
  const suiClient = useSuiClient()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const { data: chainConfig } = useChainConfig()

  const navPerShare = BigInt(navPerShareRaw || '1000000000')
  const NAV_SCALE = 1_000_000_000n
  const DUSDC_SCALE = 1_000_000n

  // Fetch PortfolioShare objects when the modal opens
  const fetchShares = useCallback(async () => {
    if (!account || !chainConfig?.sonarkPackage) return
    setLoadingShares(true)
    try {
      const result = await suiClient.getOwnedObjects({
        owner: account.address,
        filter: { StructType: `${chainConfig.sonarkPackage}::portfolio::PortfolioShare` },
        options: { showContent: true },
      })

      type MoveField = { type: string; fields?: Record<string, string> }
      type MoveContent = { dataType: string; fields?: Record<string, MoveField | string> }

      const matched: PortfolioShareObject[] = []
      for (const item of result.data) {
        const content = item.data?.content as MoveContent | undefined
        if (!content || content.dataType !== 'moveObject') continue
        const fields = content.fields as Record<string, string> | undefined
        if (!fields) continue
        // Match by the portfolio object ID this share was issued for
        if (fields['portfolio_id'] === portfolioObjectId) {
          matched.push({
            objectId: item.data!.objectId,
            navPerShare,
          })
        }
      }
      setShares(matched)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    } finally {
      setLoadingShares(false)
    }
  }, [account, chainConfig, suiClient, portfolioObjectId, navPerShare])

  // Load shares when modal opens
  const handleOpenChange = (isOpen: boolean) => {
    if (isOpen) {
      void fetchShares()
    } else {
      if (step === 'withdrawing') return
      setStep('preview')
      setShares([])
      setTxDigest('')
      setErrorMsg('')
      onClose()
    }
  }

  const estimatedDusdc = shares.reduce((acc) => {
    // 1 share = navPerShare / NAV_SCALE DUSDC (raw)
    return acc + (navPerShare * 1n) / NAV_SCALE
  }, 0n)

  const handleWithdraw = useCallback(async () => {
    if (!account || !chainConfig?.sonarkPackage) return
    if (shares.length === 0) return

    const PKG   = chainConfig.sonarkPackage
    const DUSDC = chainConfig.dusdcType
    const CLOCK = chainConfig.clockId

    setStep('withdrawing')
    try {
      const tx = new Transaction()
      const coins: ReturnType<typeof tx.moveCall>[] = []

      for (const share of shares) {
        const coin = tx.moveCall({
          target: `${PKG}::portfolio::withdraw`,
          typeArguments: [DUSDC],
          arguments: [
            tx.object(portfolioObjectId),
            tx.object(share.objectId),
            tx.object(CLOCK),
          ],
        })
        coins.push(coin)
      }

      // Transfer all redeemed DUSDC coins to the user
      tx.transferObjects(coins, account.address)

      const result = await signAndExecute({ transaction: tx })
      setTxDigest(result.digest)
      setStep('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }, [account, chainConfig, shares, portfolioObjectId, signAndExecute])

  const dusdcFormatted = (Number(estimatedDusdc) / Number(DUSDC_SCALE)).toFixed(6)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Withdraw</DialogTitle>
          <DialogDescription>
            Redeem your PortfolioShare tokens for DUSDC at current NAV.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">

          {/* ── Preview ──────────────────────────────────────────────── */}
          {step === 'preview' && (
            <motion.div
              key="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-4"
            >
              {loadingShares ? (
                <div className="py-6 flex justify-center">
                  <Loader className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
                </div>
              ) : shares.length === 0 ? (
                <div
                  className="rounded-lg px-4 py-8 text-center text-sm"
                  style={{ background: 'var(--bg-inset)', color: 'var(--ink-muted)', border: '1px solid var(--line)' }}
                >
                  No PortfolioShare tokens found in your wallet for this portfolio.
                </div>
              ) : (
                <>
                  <div
                    className="rounded-lg divide-y"
                    style={{ border: '1px solid var(--line)', background: 'var(--bg-inset)' }}
                  >
                    <div className="flex justify-between px-4 py-2.5 text-sm">
                      <span style={{ color: 'var(--ink-muted)' }}>Shares to redeem</span>
                      <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>{shares.length}</span>
                    </div>
                    <div className="flex justify-between px-4 py-2.5 text-sm">
                      <span style={{ color: 'var(--ink-muted)' }}>NAV per share</span>
                      <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>
                        {formatNav(navPerShareRaw)}
                      </span>
                    </div>
                    <div className="flex justify-between px-4 py-2.5 text-sm">
                      <span style={{ color: 'var(--ink-muted)' }}>Est. DUSDC received</span>
                      <span className="font-semibold" style={{ color: 'var(--status-green)' }}>
                        {dusdcFormatted} DUSDC
                      </span>
                    </div>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                    All {shares.length} share token{shares.length !== 1 ? 's' : ''} will be burned in one transaction.
                    Actual DUSDC received depends on vault balance at settlement.
                  </p>
                </>
              )}
            </motion.div>
          )}

          {/* ── Withdrawing ─────────────────────────────────────────── */}
          {step === 'withdrawing' && (
            <motion.div
              key="withdrawing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-8 flex flex-col items-center gap-3"
            >
              <Loader className="w-8 h-8 animate-spin" style={{ color: 'var(--accent)' }} />
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>
                Burning share tokens and redeeming DUSDC…
              </p>
            </motion.div>
          )}

          {/* ── Done ────────────────────────────────────────────────── */}
          {step === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-6 text-center space-y-4"
            >
              <CheckCircle className="w-10 h-10 mx-auto" style={{ color: 'var(--status-green)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--ink-primary)' }}>Withdrawal complete</p>
                <p className="text-sm mt-1" style={{ color: 'var(--ink-secondary)' }}>
                  {dusdcFormatted} DUSDC has been returned to your wallet.
                </p>
              </div>
              {txDigest && (
                <a
                  href={txUrl(txDigest)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs hover:underline"
                  style={{ color: 'var(--accent)' }}
                >
                  View on Explorer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </motion.div>
          )}

          {/* ── Error ───────────────────────────────────────────────── */}
          {step === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-4"
            >
              <div
                className="flex items-start gap-2 rounded-lg px-4 py-3"
                style={{ background: 'rgba(240,68,56,0.08)', border: '1px solid rgba(240,68,56,0.2)' }}
              >
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--status-red)' }} />
                <p className="text-sm" style={{ color: 'var(--status-red)' }}>{errorMsg}</p>
              </div>
            </motion.div>
          )}

        </AnimatePresence>

        <DialogFooter>
          {step === 'done' ? (
            <Button onClick={() => handleOpenChange(false)}>Close</Button>
          ) : step === 'error' ? (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>Close</Button>
              <Button onClick={() => { setStep('preview'); setErrorMsg(''); void fetchShares() }}>Retry</Button>
            </>
          ) : step === 'preview' ? (
            <>
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
              <Button
                onClick={handleWithdraw}
                disabled={loadingShares || shares.length === 0 || !account}
              >
                {!account ? 'Connect wallet' : `Withdraw ${shares.length} share${shares.length !== 1 ? 's' : ''}`}
              </Button>
            </>
          ) : null /* withdrawing — no buttons */}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── RenewPolicyCapModal ────────────────────────────────────────────────────────

type RenewStep = 'preview' | 'renewing' | 'done' | 'error'

function RenewPolicyCapModal({
  open,
  onClose,
  portfolioObjectId,
  policyCapId,
  currentExpiryMs,
}: {
  open: boolean
  onClose: () => void
  portfolioObjectId: string
  policyCapId: string
  currentExpiryMs: number
}) {
  const [step, setStep] = useState<RenewStep>('preview')
  const [txDigest, setTxDigest] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const account = useCurrentAccount()
  const { mutateAsync: signAndExecute } = useSignAndExecuteTransaction()
  const { data: chainConfig } = useChainConfig()

  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000
  const newExpiryMs = BigInt(Math.max(currentExpiryMs, Date.now()) + THIRTY_DAYS_MS)
  const newBudgetCapRaw = 5_000_000n * 1_000n  // 5,000 DUSDC budget cap

  const handleRenew = useCallback(async () => {
    if (!account || !chainConfig?.sonarkPackage) return
    const PKG   = chainConfig.sonarkPackage
    const DUSDC = chainConfig.dusdcType

    setStep('renewing')
    try {
      const tx = new Transaction()
      tx.moveCall({
        target: `${PKG}::portfolio::refresh_policy`,
        typeArguments: [DUSDC],
        arguments: [
          tx.object(portfolioObjectId),
          tx.object(policyCapId),
          tx.pure.u64(newBudgetCapRaw),
          tx.pure.u64(newExpiryMs),
        ],
      })
      const result = await signAndExecute({ transaction: tx })
      setTxDigest(result.digest)
      setStep('done')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }, [account, chainConfig, portfolioObjectId, policyCapId, newBudgetCapRaw, newExpiryMs, signAndExecute])

  const handleClose = () => {
    if (step === 'renewing') return
    setStep('preview')
    setTxDigest('')
    setErrorMsg('')
    onClose()
  }

  const newExpiryDate = new Date(Number(newExpiryMs)).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  })

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Renew PolicyCap</DialogTitle>
          <DialogDescription>
            Extend keeper authorization for another 30 days.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 'preview' && (
            <motion.div key="preview" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
              <div className="rounded-lg divide-y" style={{ border: '1px solid var(--line)', background: 'var(--bg-inset)' }}>
                {([
                  ['New expiry', newExpiryDate],
                  ['New budget cap', `${(Number(newBudgetCapRaw) / 1e6).toLocaleString()} DUSDC`],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className="flex justify-between px-4 py-2.5 text-sm">
                    <span style={{ color: 'var(--ink-muted)' }}>{k}</span>
                    <span className="font-medium" style={{ color: 'var(--ink-primary)' }}>{v}</span>
                  </div>
                ))}
              </div>
              <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                This calls <code>portfolio::refresh_policy</code> on-chain. You must be the portfolio owner.
              </p>
            </motion.div>
          )}

          {step === 'renewing' && (
            <motion.div key="renewing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-8 flex flex-col items-center gap-3">
              <Loader className="w-8 h-8 animate-spin" style={{ color: 'var(--accent)' }} />
              <p className="text-sm" style={{ color: 'var(--ink-secondary)' }}>Submitting renewal transaction…</p>
            </motion.div>
          )}

          {step === 'done' && (
            <motion.div key="done" initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="py-6 text-center space-y-4">
              <CheckCircle className="w-10 h-10 mx-auto" style={{ color: 'var(--status-green)' }} />
              <div>
                <p className="font-semibold" style={{ color: 'var(--ink-primary)' }}>PolicyCap renewed!</p>
                <p className="text-sm mt-1" style={{ color: 'var(--ink-secondary)' }}>
                  The keeper is authorized until {newExpiryDate}.
                </p>
              </div>
              {txDigest && (
                <a href={txUrl(txDigest)} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs hover:underline" style={{ color: 'var(--accent)' }}>
                  View on Explorer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </motion.div>
          )}

          {step === 'error' && (
            <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="py-4">
              <div className="flex items-start gap-2 rounded-lg px-4 py-3"
                style={{ background: 'rgba(240,68,56,0.08)', border: '1px solid rgba(240,68,56,0.2)' }}>
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
              <Button onClick={() => { setStep('preview'); setErrorMsg('') }}>Retry</Button>
            </>
          ) : step === 'preview' ? (
            <>
              <Button variant="ghost" onClick={handleClose}>Cancel</Button>
              <Button onClick={handleRenew} disabled={!account}>
                {!account ? 'Connect wallet' : 'Renew 30 Days'}
              </Button>
            </>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function PortfolioDetail() {
  const { id } = useParams<{ id: string }>()
  const { data: portfolio, isLoading, error } = usePortfolioDetail(id!)
  const { mutate: patchPortfolio, isPending: isPausing } = usePatchPortfolio(id!)
  const [showConfig, setShowConfig] = useState(false)
  const [showWithdraw, setShowWithdraw] = useState(false)
  const [showRenew, setShowRenew] = useState(false)
  const [policyCapExpiryMs, setPolicyCapExpiryMs] = useState<number | null>(null)

  const suiClient = useSuiClient()

  // Read PolicyCap expiry_ms from the on-chain object
  useEffect(() => {
    if (!portfolio?.policyCapId) return
    suiClient.getObject({ id: portfolio.policyCapId, options: { showContent: true } })
      .then((res) => {
        const content = res.data?.content
        if (content && 'fields' in content) {
          const fields = content.fields as Record<string, unknown>
          if (fields['expiry_ms']) setPolicyCapExpiryMs(Number(fields['expiry_ms']))
        }
      })
      .catch(() => { /* non-fatal */ })
  }, [portfolio?.policyCapId, suiClient])

  if (isLoading) {
    return (
      <div className="px-10 py-12 max-w-[1600px] space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
        </div>
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    )
  }

  if (error || !portfolio) {
    return (
      <div className="px-10 py-12 max-w-[1600px]">
        <div className="rounded-xl p-8 text-center border border-danger/20 bg-danger/5">
          <p className="text-sm mb-4 text-danger">
            {error ? 'Failed to load portfolio.' : 'Portfolio not found.'}
          </p>
          <Button asChild variant="outline">
            <Link to="/portfolios">Back to Portfolios</Link>
          </Button>
        </div>
      </div>
    )
  }

  const rawNavHistory = portfolio.navHistory ?? []
  const navChartData = rawNavHistory.map((p) => ({
    date: p.ts,
    value: Number(p.navPerShare) / 1_000_000_000,
  }))
  const latestNav = rawNavHistory.at(-1)?.navPerShare ?? portfolio.navPerShareRaw

  return (
    <div className="px-10 py-12 max-w-[1600px] space-y-8">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/portfolios">
              <ArrowLeft className="w-4 h-4" /> Back
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold uppercase" style={{ color: 'var(--ink-primary)' }}>
                {portfolio.name}
              </h1>
              <StrategyBadge strategyType={portfolio.strategyType} />
            </div>
            <p className="text-xs mt-0.5" style={{ color: 'var(--ink-muted)' }}>
              {STRATEGY_NAMES[portfolio.strategyType]}
              {portfolio.vaultObjectId ? ` · ${portfolio.vaultObjectId.slice(0, 8)}…` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isPausing}
            onClick={() => patchPortfolio({ is_paused: !portfolio.isPaused })}
          >
            {portfolio.isPaused
              ? <><Play className="w-3.5 h-3.5" /> Resume</>
              : <><Pause className="w-3.5 h-3.5" /> Pause</>
            }
          </Button>
          {portfolio.vaultObjectId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWithdraw(true)}
            >
              <LogOut className="w-3.5 h-3.5" /> Withdraw
            </Button>
          )}
          {portfolio.policyCapId && (
            <Button variant="outline" size="sm" onClick={() => setShowRenew(true)}>
              <RefreshCw className="w-3.5 h-3.5" /> Renew Cap
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => setShowConfig(true)}>
            <Settings className="w-3.5 h-3.5" /> Settings
          </Button>
        </div>
      </div>

      {/* Risk disclosure — non-dismissible for bettor strategies */}
      <RiskDisclosure strategyType={portfolio.strategyType} />

      {/* Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="NAV per Share"
          value={latestNav != null ? formatNav(latestNav) : '—'}
          subtitle="Normalized to 1e9 initial"
          icon={TrendingUp as LucideIcon}
          trend={
            latestNav != null && BigInt(latestNav) > 1_000_000_000n
              ? 'up'
              : latestNav != null && BigInt(latestNav) < 1_000_000_000n
              ? 'down'
              : 'neutral'
          }
        />
        <StatCard
          label="Total Deposited"
          value={formatDusdc(portfolio.totalDepositedRaw)}
          subtitle="Principal in vault"
          icon={DollarSign as LucideIcon}
        />
        <StatCard
          label="Cycle Count"
          value={String((portfolio.cycles ?? portfolio.recentCycles).length)}
          subtitle="Keeper rounds executed"
          icon={Activity as LucideIcon}
        />
        <StatCard
          label="Last Active"
          value={portfolio.lastKeeperRun ? formatDateTime(portfolio.lastKeeperRun) : 'Never'}
          subtitle="Keeper last run"
          icon={Clock as LucideIcon}
        />
      </div>

      {/* PolicyCap expiry banner — shown when expiry is within 30 days or already passed */}
      {policyCapExpiryMs !== null && policyCapExpiryMs < Date.now() + 30 * 24 * 60 * 60 * 1000 && (
        <div
          className="flex items-center justify-between rounded-xl px-5 py-3.5"
          style={{
            background: policyCapExpiryMs < Date.now()
              ? 'rgba(240,68,56,0.08)' : 'rgba(232,166,39,0.07)',
            border: `1px solid ${policyCapExpiryMs < Date.now() ? 'rgba(240,68,56,0.2)' : 'rgba(232,166,39,0.18)'}`,
          }}
        >
          <div className="flex items-start gap-3">
            <AlertCircle
              className="w-4 h-4 shrink-0 mt-0.5"
              style={{ color: policyCapExpiryMs < Date.now() ? 'var(--status-red)' : 'var(--status-yellow)' }}
            />
            <div>
              <p className="text-sm font-medium" style={{ color: 'var(--ink-primary)' }}>
                {policyCapExpiryMs < Date.now() ? 'PolicyCap expired' : 'PolicyCap expiring soon'}
              </p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--ink-secondary)' }}>
                {policyCapExpiryMs < Date.now()
                  ? 'The keeper cannot act until you renew the policy. Renew to resume automatic execution.'
                  : `Expires ${new Date(policyCapExpiryMs).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Renew before it lapses.`
                }
              </p>
            </div>
          </div>
          <Button size="sm" onClick={() => setShowRenew(true)} className="shrink-0 ml-4">
            <RefreshCw className="w-3.5 h-3.5" /> Renew
          </Button>
        </div>
      )}

      <Tabs defaultValue="performance">
        <TabsList>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="cycles">Cycle History</TabsTrigger>
          <TabsTrigger value="positions">Open Positions</TabsTrigger>
        </TabsList>

        {/* NAV chart */}
        <TabsContent value="performance">
          <div className="space-y-5 mt-3">
            <BracketCard className="p-5">
              <div className="mb-4">
                <p className="section-label mb-1">NAV History</p>
                <p className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                  Share price normalized to 1,000,000,000 at deposit
                </p>
              </div>
              {navChartData.length < 2 ? (
                <div className="h-48 flex items-center justify-center text-sm" style={{ color: 'var(--ink-muted)' }}>
                  Not enough data points yet. Run more keeper cycles to see the chart.
                </div>
              ) : (
                <NavChart data={navChartData} />
              )}
            </BracketCard>

            {/* PnL summary */}
            <div className="grid grid-cols-3 gap-4">
              {[
                {
                  label: 'Total Return',
                  value: portfolio.totalReturnPct != null ? formatPct(portfolio.totalReturnPct) : '—',
                  positive: (portfolio.totalReturnPct ?? 0) >= 0,
                  redFlag: (portfolio.totalReturnPct ?? 0) < 0,
                },
                {
                  label: 'Rolling APY',
                  value: portfolio.rollingApyPct != null ? formatApy(portfolio.rollingApyPct) : '—',
                  positive: true,
                  redFlag: false,
                },
                {
                  label: 'Max Drawdown',
                  value: portfolio.maxDrawdownPct != null ? formatPct(-Math.abs(portfolio.maxDrawdownPct)) : '—',
                  positive: false,
                  redFlag: true,
                },
              ].map(({ label, value, positive, redFlag }) => (
                <div
                  key={label}
                  className="rounded-xl p-4"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--line)' }}
                >
                  <p className="section-label mb-1">{label}</p>
                  <p
                    className="text-2xl font-bold"
                    style={{
                      color: redFlag
                        ? 'var(--status-red)'
                        : positive
                        ? 'var(--status-green)'
                        : 'var(--ink-primary)',
                    }}
                  >
                    {value}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>

        {/* Cycle history */}
        <TabsContent value="cycles">
          <div className="mt-3">
            {(portfolio.cycles ?? portfolio.recentCycles).length === 0 ? (
              <div
                className="rounded-xl p-8 text-center text-sm"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
              >
                No cycles executed yet. The keeper runs every sub-hour expiry.
              </div>
            ) : (
              <CycleTable cycles={portfolio.cycles ?? portfolio.recentCycles} />
            )}
          </div>
        </TabsContent>

        {/* Open positions */}
        <TabsContent value="positions">
          <div className="mt-3">
            {portfolio.openPositions.length === 0 ? (
              <div
                className="rounded-xl p-8 text-center text-sm"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--line)', color: 'var(--ink-muted)' }}
              >
                No open positions. The keeper will open positions on the next expiry cycle.
              </div>
            ) : (
              <div
                className="rounded-xl overflow-hidden"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--line)' }}
              >
                <div
                  className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-4 px-5 py-3 border-b text-[10px] uppercase tracking-wider"
                  style={{ borderColor: 'var(--line)', color: 'var(--ink-muted)' }}
                >
                  <span>Market</span>
                  <span>Type</span>
                  <span>Notional</span>
                  <span>Payout</span>
                  <span>Opened</span>
                </div>
                <div className="divide-y" style={{ borderColor: 'var(--line-subtle)' }}>
                  {portfolio.openPositions.map((pos, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: i * 0.04 }}
                      className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr] gap-4 px-5 py-3.5 text-sm items-center"
                    >
                      <span className="font-mono text-xs" style={{ color: 'var(--ink-primary)' }}>
                        {pos.marketId.slice(0, 10)}…
                      </span>
                      <span className="capitalize" style={{ color: 'var(--ink-secondary)' }}>
                        {pos.positionType}
                      </span>
                      <span style={{ color: 'var(--ink-primary)' }}>{formatDusdc(pos.notional)}</span>
                      <span style={{ color: 'var(--status-green)' }}>{formatDusdc(pos.maxPayout)}</span>
                      <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>
                        {formatDateTime(pos.openedAt)}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <ConfigModal
        open={showConfig}
        onClose={() => setShowConfig(false)}
        portfolioId={id!}
        currentConfig={{ name: portfolio.name }}
      />

      {portfolio.vaultObjectId && (
        <WithdrawModal
          open={showWithdraw}
          onClose={() => setShowWithdraw(false)}
          portfolioObjectId={portfolio.vaultObjectId}
          navPerShareRaw={portfolio.navPerShareRaw}
        />
      )}

      {portfolio.vaultObjectId && portfolio.policyCapId && (
        <RenewPolicyCapModal
          open={showRenew}
          onClose={() => setShowRenew(false)}
          portfolioObjectId={portfolio.vaultObjectId}
          policyCapId={portfolio.policyCapId}
          currentExpiryMs={policyCapExpiryMs ?? Date.now()}
        />
      )}
    </div>
  )
}
