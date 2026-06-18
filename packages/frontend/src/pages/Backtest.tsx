import { useState } from 'react'
import { Play, CheckCircle, XCircle, Loader, FlaskConical, Clock } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBacktest, type RunRecord } from '@/hooks/useBacktest'
import { ResultChart } from '@/components/backtest/ResultChart'
import { RegimeTable } from '@/components/backtest/RegimeTable'
import { BracketCard } from '@/components/common/BracketCard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPct, formatApy } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'
import { cn } from '@/lib/cn'

const STRATEGY_OPTIONS = [0, 1, 2, 3, 4, 5, 6]

const TIMEFRAME_OPTIONS = [
  { value: '7d',  label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All available data' },
]

// ── Simulation progress steps ─────────────────────────────────────────────────

const SIM_STEPS = [
  { label: 'Loading oracle data', threshold: 0 },
  { label: 'Computing strategy cycles', threshold: 40 },
  { label: 'Building PnL curve', threshold: 80 },
]

function SimProgress({ progress }: { progress: number }) {
  return (
    <div className="py-8 space-y-5">
      <p className="section-label mb-6" style={{ color: 'var(--accent)' }}>Running Simulation</p>
      {SIM_STEPS.map(({ label, threshold }, i) => {
        const done   = progress > threshold + 35
        const active = progress >= threshold && !done

        return (
          <motion.div
            key={label}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.1 }}
            className="flex items-center gap-4"
          >
            <div className="w-6 h-6 shrink-0 flex items-center justify-center">
              {done ? (
                <CheckCircle className="w-5 h-5" style={{ color: 'var(--status-green)' }} />
              ) : active ? (
                <Loader className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
              ) : (
                <div
                  className="w-5 h-5 rounded-full border-2"
                  style={{ borderColor: 'var(--line-strong)' }}
                />
              )}
            </div>
            <span
              className="text-sm font-medium uppercase tracking-wide"
              style={{
                color: done
                  ? 'var(--ink-secondary)'
                  : active
                  ? 'var(--ink-primary)'
                  : 'var(--ink-muted)',
              }}
            >
              {label}
            </span>
            {active && (
              <span className="text-xs ml-auto" style={{ color: 'var(--ink-muted)' }}>
                {progress}%
              </span>
            )}
          </motion.div>
        )
      })}

      {/* Progress bar */}
      <div className="mt-6 h-0.5 rounded-full overflow-hidden" style={{ background: 'var(--line)' }}>
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'var(--accent)' }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

// ── Run history sidebar item ──────────────────────────────────────────────────

function RunHistoryItem({ result, isActive, onClick }: { result: RunRecord; isActive: boolean; onClick: () => void }) {
  const profit = (result.metrics.totalReturnPct ?? 0) >= 0

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border transition-all',
        isActive
          ? 'border-[rgba(169,168,236,0.4)] bg-[rgba(169,168,236,0.08)]'
          : 'border-[rgba(255,255,255,0.06)] hover:border-[rgba(169,168,236,0.2)]',
      )}
    >
      {result.status === 'completed' ? (
        <CheckCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--status-green)' }} />
      ) : result.status === 'failed' ? (
        <XCircle className="w-4 h-4 shrink-0" style={{ color: 'var(--status-red)' }} />
      ) : (
        <Clock className="w-4 h-4 shrink-0 animate-pulse" style={{ color: 'var(--status-yellow)' }} />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink-primary)' }}>
          {STRATEGY_NAMES[result.strategyType]}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--ink-muted)' }}>{result.timeframe}</p>
      </div>
      {result.metrics.totalReturnPct != null && (
        <span
          className="text-xs font-bold shrink-0"
          style={{ color: profit ? 'var(--status-green)' : 'var(--status-red)' }}
        >
          {formatPct(result.metrics.totalReturnPct)}
        </span>
      )}
    </button>
  )
}

// ── Result metrics ────────────────────────────────────────────────────────────

function MetricBox({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color?: string
}) {
  return (
    <div
      className="rounded-xl px-5 py-4"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--line)' }}
    >
      <p className="section-label mb-2">{label}</p>
      <p
        className="hero-num text-[32px]"
        style={{ color: color ?? 'var(--ink-primary)' }}
      >
        {value}
      </p>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Backtest() {
  const [strategyType, setStrategyType] = useState<number>(0)
  const [timeframe, setTimeframe]        = useState('30d')
  const [selectedResult, setSelectedResult] = useState<RunRecord | null>(null)

  const { mutate, isPending, progress, runHistory } = useBacktest()

  function handleRun() {
    mutate(
      { strategyType, timeframe },
      { onSuccess: (r) => setSelectedResult(r) },
    )
  }

  const displayResult = selectedResult ?? runHistory[0] ?? null

  return (
    <div className="space-y-8">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div>
        <p className="section-label mb-3">Studio</p>
        <h1 className="page-title">Simulation Room</h1>
        <p className="text-sm mt-3" style={{ color: 'var(--ink-secondary)' }}>
          Replay strategies against real oracle and SVI data. Results use synthetic trader flow on testnet.
        </p>
      </div>

      <div className="flex gap-6 items-start">

        {/* ── Left: controls + run history ─────────────────────────── */}
        <div className="w-72 shrink-0 space-y-5">

          <BracketCard className="p-6 space-y-5">
            <p className="section-label" style={{ color: 'var(--accent)' }}>Run Controls</p>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Strategy
              </Label>
              <Select value={String(strategyType)} onValueChange={(v) => setStrategyType(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map((t) => (
                    <SelectItem key={t} value={String(t)}>
                      {STRATEGY_NAMES[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider" style={{ color: 'var(--ink-muted)' }}>
                Time Range
              </Label>
              <Select value={timeframe} onValueChange={setTimeframe}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEFRAME_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button
              onClick={handleRun}
              disabled={isPending}
              className="w-full btn-pill"
            >
              <Play className="w-4 h-4" />
              {isPending ? 'Simulating…' : 'Run Simulation'}
            </Button>
          </BracketCard>

          {/* Run history */}
          {runHistory.length > 0 && (
            <div>
              <p className="section-label mb-3">Run History</p>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {runHistory.map((r, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                    >
                      <RunHistoryItem
                        result={r}
                        isActive={displayResult === r}
                        onClick={() => setSelectedResult(r)}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: results area ───────────────────────────────────── */}
        <div className="flex-1 min-w-0">

          {/* Loading state */}
          {isPending && (
            <BracketCard className="p-8">
              <SimProgress progress={progress} />
            </BracketCard>
          )}

          {/* Empty state */}
          {!isPending && !displayResult && (
            <div className="flex flex-col items-center justify-center py-28 text-center">
              <div
                className="w-16 h-16 rounded-full flex items-center justify-center mb-6"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--line)' }}
              >
                <FlaskConical className="w-7 h-7" style={{ color: 'var(--ink-muted)' }} />
              </div>
              <p className="card-heading mb-3 text-[15px]" style={{ color: 'var(--ink-secondary)' }}>
                Ready to simulate
              </p>
              <p className="text-xs" style={{ color: 'var(--ink-muted)', maxWidth: 260 }}>
                Select a strategy and time range, then run the simulation to see PnL curves, regime breakdown, and spread analysis.
              </p>
            </div>
          )}

          {/* Results */}
          <AnimatePresence mode="wait">
            {displayResult?.status === 'completed' && !isPending && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {/* Strategy + timeframe label */}
                <div>
                  <p className="section-label mb-1">
                    {STRATEGY_NAMES[displayResult.strategyType]} · {displayResult.timeframe}
                  </p>
                  <h2 className="card-heading">Simulation Results</h2>
                </div>

                {/* Hero metrics */}
                <div className="grid grid-cols-3 gap-4">
                  <MetricBox
                    label="Total Return"
                    value={displayResult.metrics.totalReturnPct != null ? formatPct(displayResult.metrics.totalReturnPct) : '—'}
                    color={(displayResult.metrics.totalReturnPct ?? 0) >= 0 ? 'var(--status-green)' : 'var(--status-red)'}
                  />
                  <MetricBox
                    label="Rolling APY"
                    value={displayResult.metrics.apyPct != null ? formatApy(displayResult.metrics.apyPct) : '—'}
                  />
                  <MetricBox
                    label="Max Drawdown"
                    value={displayResult.metrics.maxDrawdownPct != null ? formatPct(-Math.abs(displayResult.metrics.maxDrawdownPct)) : '—'}
                    color="var(--status-red)"
                  />
                </div>

                <div className="grid grid-cols-3 gap-4">
                  <MetricBox
                    label="Win Rate"
                    value={displayResult.metrics.winRate != null ? formatPct(displayResult.metrics.winRate * 100) : '—'}
                  />
                  <MetricBox
                    label="Spread Eaten"
                    value={displayResult.metrics.spreadCostPct != null ? formatPct(displayResult.metrics.spreadCostPct) : '—'}
                    color="var(--status-yellow)"
                  />
                  <MetricBox
                    label="Cycle Count"
                    value={String(displayResult.metrics.cycleCount ?? '—')}
                  />
                </div>

                {/* Synthetic flow caveat */}
                <div
                  className="rounded-lg px-4 py-3 text-xs"
                  style={{
                    border: '1px solid var(--accent-border)',
                    background: 'var(--accent-muted)',
                    color: 'var(--ink-secondary)',
                  }}
                >
                  <strong style={{ color: 'var(--accent-light)' }}>Note:</strong> Synthetic trader flow — /trades endpoint was empty on testnet. Returns reflect spread mechanics on assumed volume, not observed fill rates.
                </div>

                {/* PnL curve */}
                <BracketCard className="p-6">
                  <p className="section-label mb-5" style={{ color: 'var(--accent)' }}>Cumulative PnL Curve</p>
                  {displayResult.equityCurve && displayResult.equityCurve.length > 1 ? (
                    <ResultChart data={displayResult.equityCurve} initialCapital={1000} />
                  ) : (
                    <div className="h-48 flex items-center justify-center text-sm" style={{ color: 'var(--ink-muted)' }}>
                      Insufficient data points to render chart.
                    </div>
                  )}
                </BracketCard>

                {/* Regime breakdown */}
                {displayResult.regimeBreakdown && Object.keys(displayResult.regimeBreakdown).length > 0 && (
                  <div>
                    <p className="section-label mb-3" style={{ color: 'var(--accent)' }}>Regime Breakdown</p>
                    <RegimeTable regimeBreakdown={displayResult.regimeBreakdown} />
                  </div>
                )}
              </motion.div>
            )}

            {displayResult?.status === 'failed' && !isPending && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl p-8 text-center"
                style={{ border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(239,68,68,0.06)' }}
              >
                <p className="text-sm" style={{ color: 'var(--status-red)' }}>
                  Simulation failed: {displayResult.error ?? 'Unknown error. Check the API server logs.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
