import { useState } from 'react'
import { FlaskConical, Play, Clock, CheckCircle, XCircle } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBacktest, type RunRecord } from '@/hooks/useBacktest'
import { ResultChart } from '@/components/backtest/ResultChart'
import { RegimeTable } from '@/components/backtest/RegimeTable'
import { BracketCard } from '@/components/common/BracketCard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { formatPct, formatApy } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'

const STRATEGY_OPTIONS = [0, 1, 2, 3, 4, 5, 6]

const TIMEFRAME_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All available data' },
]

function RunHistoryItem({ result, isActive }: { result: RunRecord; isActive: boolean }) {
  const profit = (result.metrics.totalReturnPct ?? 0) >= 0
  return (
    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-colors cursor-pointer ${
      isActive
        ? 'border-[rgba(169,168,236,0.4)] bg-[rgba(169,168,236,0.08)]'
        : 'border-[rgba(255,255,255,0.06)] bg-transparent hover:border-[rgba(169,168,236,0.2)]'
    }`}>
      {result.status === 'completed' ? (
        <CheckCircle className="w-4 h-4 text-[#3DD68C] shrink-0" />
      ) : result.status === 'failed' ? (
        <XCircle className="w-4 h-4 text-[#F04438] shrink-0" />
      ) : (
        <Clock className="w-4 h-4 text-[#fbbf24] shrink-0 animate-pulse" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-white truncate">{STRATEGY_NAMES[result.strategyType]}</p>
        <p className="text-[10px] text-[#58586A]">{result.timeframe}</p>
      </div>
      {result.metrics.totalReturnPct != null && (
        <span className={`text-xs font-bold ${profit ? 'text-[#3DD68C]' : 'text-[#F04438]'}`}>
          {formatPct(result.metrics.totalReturnPct)}
        </span>
      )}
    </div>
  )
}

export default function Backtest() {
  const [strategyType, setStrategyType] = useState<number>(0)
  const [timeframe, setTimeframe] = useState('30d')
  const [selectedResult, setSelectedResult] = useState<RunRecord | null>(null)

  const { mutate, isPending, progress, runHistory } = useBacktest()

  function handleRun() {
    mutate(
      { strategyType, timeframe },
      {
        onSuccess: (result) => {
          setSelectedResult(result)
        },
      }
    )
  }

  const displayResult = selectedResult ?? runHistory[0] ?? null

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">Studio</p>
        <h1 className="text-2xl font-semibold text-white">Backtest</h1>
        <p className="text-sm text-[#9191A4] mt-1">
          Replay strategies against real predict-server oracle/SVI data. Results use synthetic trader flow on testnet.
        </p>
      </div>

      <div className="flex gap-6">
        {/* Left panel — form + history */}
        <div className="w-72 shrink-0 space-y-5">
          {/* Config form */}
          <BracketCard className="p-5 space-y-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#58586A] mb-3">Configuration</p>
            </div>
            <div className="space-y-2">
              <Label>Strategy</Label>
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
              <Label>Timeframe</Label>
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

            {isPending && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-[10px] text-[#58586A]">
                  <span>Running…</span>
                  <span>{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            <Button
              onClick={handleRun}
              disabled={isPending}
              className="w-full btn-pill"
            >
              <Play className="w-4 h-4" />
              {isPending ? 'Running backtest…' : 'Run Backtest'}
            </Button>
          </BracketCard>

          {/* Run history */}
          {runHistory.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-[#58586A] mb-3">Run History</p>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {runHistory.map((r, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      onClick={() => setSelectedResult(r)}
                    >
                      <RunHistoryItem result={r} isActive={displayResult === r} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Right panel — results */}
        <div className="flex-1 min-w-0 space-y-5">
          {isPending && !displayResult && (
            <div className="space-y-4">
              <Skeleton className="h-60 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          )}

          {!isPending && !displayResult && (
            <div className="h-full flex flex-col items-center justify-center py-24 text-center">
              <div className="w-12 h-12 rounded-full bg-[#242429] flex items-center justify-center mb-4">
                <FlaskConical className="w-5 h-5 text-[#58586A]" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">No results yet</h3>
              <p className="text-xs text-[#58586A] max-w-xs">
                Select a strategy and timeframe, then click Run Backtest to see PnL curves, regime breakdown, and spread analysis.
              </p>
            </div>
          )}

          <AnimatePresence mode="wait">
            {displayResult && displayResult.status === 'completed' && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-5"
              >
                {/* Headline metrics */}
                <div className="grid grid-cols-3 gap-4">
                  {[
                    {
                      label: 'Total Return',
                      value: displayResult.metrics.totalReturnPct != null ? formatPct(displayResult.metrics.totalReturnPct) : '—',
                      color: (displayResult.metrics.totalReturnPct ?? 0) >= 0 ? 'text-[#3DD68C]' : 'text-[#F04438]',
                    },
                    {
                      label: 'Rolling APY',
                      value: displayResult.metrics.apyPct != null ? formatApy(displayResult.metrics.apyPct) : '—',
                      color: 'text-white',
                    },
                    {
                      label: 'Max Drawdown',
                      value: displayResult.metrics.maxDrawdownPct != null ? formatPct(-Math.abs(displayResult.metrics.maxDrawdownPct)) : '—',
                      color: 'text-[#F47C72]',
                    },
                    {
                      label: 'Win Rate',
                      value: displayResult.metrics.winRate != null ? formatPct(displayResult.metrics.winRate * 100) : '—',
                      color: 'text-white',
                    },
                    {
                      label: 'Spread Eaten',
                      value: displayResult.metrics.spreadCostPct != null ? formatPct(displayResult.metrics.spreadCostPct) : '—',
                      color: 'text-[#fbbf24]',
                    },
                    {
                      label: 'Cycle Count',
                      value: String(displayResult.metrics.cycleCount ?? '—'),
                      color: 'text-white',
                    },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="bg-[#1C1C21] border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3">
                      <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-1">{label}</p>
                      <p className={`text-xl font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Synthetic flow caveat */}
                <div className="rounded-lg border border-[rgba(169,168,236,0.15)] bg-[rgba(169,168,236,0.05)] px-4 py-3 text-xs text-[#9191A4]">
                  <strong className="text-[#D4CDF9]">Note:</strong> Backtest uses synthetic trader flow — the /trades endpoint was empty on testnet. Returns reflect spread mechanics on assumed volume, not observed fill rates.
                </div>

                {/* PnL curve */}
                <BracketCard className="p-5">
                  <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-4">Cumulative PnL Curve</p>
                  {displayResult.equityCurve && displayResult.equityCurve.length > 1 ? (
                    <ResultChart data={displayResult.equityCurve} initialCapital={1000} />
                  ) : (
                    <div className="h-48 flex items-center justify-center text-sm text-[#58586A]">
                      Insufficient data points to render chart.
                    </div>
                  )}
                </BracketCard>

                {/* Regime table */}
                {displayResult.regimeBreakdown && Object.keys(displayResult.regimeBreakdown).length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-[#58586A] mb-3">Regime Breakdown</p>
                    <RegimeTable regimeBreakdown={displayResult.regimeBreakdown} />
                  </div>
                )}
              </motion.div>
            )}

            {displayResult && displayResult.status === 'failed' && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.06)] p-8 text-center"
              >
                <p className="text-sm text-[#F47C72]">
                  Backtest failed: {displayResult.error ?? 'Unknown error. Check the API server logs.'}
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
