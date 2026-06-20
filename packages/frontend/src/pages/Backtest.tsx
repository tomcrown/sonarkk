import { useState } from 'react'
import { Play, CheckCircle, XCircle, Loader, FlaskConical, Clock, TrendingUp, BarChart2, Sliders } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useBacktest, type RunRecord } from '@/hooks/useBacktest'
import { ResultChart } from '@/components/backtest/ResultChart'
import { RegimeTable } from '@/components/backtest/RegimeTable'
import { VolStressChart } from '@/components/backtest/VolStressChart'
import { PnlDistribution } from '@/components/backtest/PnlDistribution'
import { SensitivityTable } from '@/components/backtest/SensitivityTable'
import { BracketCard } from '@/components/common/BracketCard'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatPct, formatApy, formatDate } from '@/lib/format'
import { STRATEGY_NAMES } from '@/lib/constants'
import { cn } from '@/lib/cn'

const STRATEGY_OPTIONS = [0, 1, 2, 3, 4, 5, 6]

const TIMEFRAME_OPTIONS = [
  { value: '7d',  label: 'Last 7 days'        },
  { value: '30d', label: 'Last 30 days'       },
  { value: '90d', label: 'Last 90 days'       },
  { value: 'all', label: 'All available data'  },
]

const SIM_STEPS = [
  { label: 'Loading oracle data',       threshold: 0  },
  { label: 'Computing strategy cycles', threshold: 40 },
  { label: 'Building PnL curve',        threshold: 80 },
]

function SimProgress({ progress }: { progress: number }) {
  return (
    <div className="py-8 space-y-5">
      <div className="text-[10px] tracking-[0.15em] text-accent mb-6">RUNNING SIMULATION</div>
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
              {done   ? <CheckCircle className="w-5 h-5 text-success" />
                : active ? <Loader className="w-5 h-5 animate-spin text-accent" />
                : <div className="w-5 h-5 rounded-full border-2 border-border" />}
            </div>
            <span className={`text-sm font-medium uppercase tracking-wide ${done ? 'text-muted-foreground' : active ? 'text-foreground' : 'text-text-dim'}`}>
              {label}
            </span>
            {active && <span className="text-xs ml-auto text-text-dim">{progress}%</span>}
          </motion.div>
        )
      })}
      <div className="mt-6 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full bg-gradient-to-r from-accent-light to-accent"
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>
    </div>
  )
}

function RunHistoryItem({ result, isActive, onClick }: { result: RunRecord; isActive: boolean; onClick: () => void }) {
  const profit = (result.metrics.totalReturnPct ?? 0) >= 0
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-center gap-3 px-4 py-3 rounded-lg border transition-all',
        isActive
          ? 'border-accent/40 bg-accent/8'
          : 'border-border hover:border-accent/20',
      )}
    >
      {result.status === 'completed' ? (
        <CheckCircle className="w-4 h-4 shrink-0 text-success" />
      ) : result.status === 'failed' ? (
        <XCircle className="w-4 h-4 shrink-0 text-danger" />
      ) : (
        <Clock className="w-4 h-4 shrink-0 animate-pulse text-warning" />
      )}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold truncate text-foreground">{STRATEGY_NAMES[result.strategyType]}</p>
        <p className="text-[10px] text-text-dim">{result.timeframe}</p>
      </div>
      {result.metrics.totalReturnPct != null && (
        <span className={`text-xs font-bold shrink-0 font-mono ${profit ? 'text-success' : 'text-danger'}`}>
          {formatPct(result.metrics.totalReturnPct)}
        </span>
      )}
    </button>
  )
}

function MetricBox({ label, value, color, sub }: { label: string; value: string; color?: string; sub?: string }) {
  return (
    <div className="bg-card border border-border rounded-lg p-5">
      <div className="text-[10px] tracking-[0.15em] text-text-dim mb-2">{label}</div>
      <div className={`text-3xl font-display ${color ? '' : 'text-foreground'}`} style={color ? { color } : {}}>
        {value}
      </div>
      {sub && <div className="text-[10px] text-text-dim mt-1">{sub}</div>}
    </div>
  )
}

function SectionHeader({ icon: Icon, label }: { icon: React.FC<{ className?: string }>; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3.5 h-3.5 text-accent" />
      <div className="text-[10px] tracking-[0.15em] text-accent">{label}</div>
    </div>
  )
}

export default function Backtest() {
  const [strategyType, setStrategyType]     = useState<number>(0)
  const [timeframe, setTimeframe]           = useState('30d')
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
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">RESEARCH</div>
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight uppercase mb-8">Simulation Room</h1>
      <p className="text-muted-foreground mb-12">
        Replay strategies against real oracle and SVI data. Results use synthetic trader flow on testnet.
      </p>

      <div className="flex flex-col lg:flex-row gap-6 items-start">
        {/* Controls + history */}
        <div className="w-full lg:w-72 lg:shrink-0 space-y-5">
          <div className="bg-card border border-border rounded-lg p-6 space-y-5">
            <div className="text-[10px] tracking-[0.15em] text-accent">RUN CONTROLS</div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-text-dim">Strategy</Label>
              <Select value={String(strategyType)} onValueChange={(v) => setStrategyType(Number(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map((t) => (
                    <SelectItem key={t} value={String(t)}>{STRATEGY_NAMES[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wider text-text-dim">Time Range</Label>
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

            <button
              onClick={handleRun}
              disabled={isPending}
              className="w-full py-3 rounded-full bg-gradient-to-r from-accent-light to-accent text-background font-medium disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {isPending
                ? <><Loader className="w-4 h-4 animate-spin" />Simulating…</>
                : <><Play className="w-4 h-4" />Run simulation</>}
            </button>

            <AnimatePresence>
              {(isPending || (displayResult?.status === 'completed')) && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="pt-4 border-t border-border"
                >
                  {isPending && <SimProgress progress={progress} />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {runHistory.length > 0 && (
            <div>
              <div className="text-[10px] tracking-[0.15em] text-text-dim mb-3">RUN HISTORY</div>
              <div className="space-y-2">
                <AnimatePresence initial={false}>
                  {runHistory.map((r, i) => (
                    <motion.div key={i} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }}>
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

        {/* Results area */}
        <div className="flex-1 min-w-0">
          {isPending && (
            <div className="bg-card border border-border rounded-lg p-8">
              <SimProgress progress={progress} />
            </div>
          )}

          {!isPending && !displayResult && (
            <div className="flex flex-col items-center justify-center py-28 text-center">
              <div className="w-16 h-16 rounded-full flex items-center justify-center mb-6 bg-card border border-border">
                <FlaskConical className="w-7 h-7 text-text-dim" />
              </div>
              <p className="text-xl font-display mb-3 text-muted-foreground">Ready to simulate</p>
              <p className="text-xs text-text-dim max-w-[260px]">
                Select a strategy and time range, then run the simulation to see PnL curves, regime breakdown, and spread analysis.
              </p>
            </div>
          )}

          <AnimatePresence mode="wait">
            {displayResult?.status === 'completed' && !isPending && (
              <motion.div
                key="results"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="space-y-6"
              >
                {/* Header */}
                <div>
                  <div className="text-[10px] tracking-[0.15em] text-text-dim mb-1">
                    {STRATEGY_NAMES[displayResult.strategyType]} · {displayResult.timeframe}
                    {displayResult.strategyClass && (
                      <span className={cn(
                        'ml-2 px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase',
                        displayResult.strategyClass === 'house'
                          ? 'bg-[rgba(61,214,140,0.12)] text-[#3DD68C] border border-[rgba(61,214,140,0.2)]'
                          : 'bg-[rgba(240,68,56,0.10)] text-[#F04438] border border-[rgba(240,68,56,0.2)]',
                      )}>
                        {displayResult.strategyClass === 'house' ? 'house · spread income' : 'bettor · short-vol'}
                      </span>
                    )}
                  </div>
                  <h2 className="text-2xl font-display">Simulation Results</h2>

                  {/* Period + BTC vol info */}
                  {displayResult.periodStart && (
                    <div className="flex flex-wrap gap-4 mt-2 text-[11px] text-[#58586A]">
                      <span>
                        Period: <span className="text-[#9191A4]">{formatDate(displayResult.periodStart.split('T')[0]!)}</span>
                        {' → '}
                        <span className="text-[#9191A4]">{formatDate(displayResult.periodEnd.split('T')[0]!)}</span>
                      </span>
                      <span>Cycles: <span className="text-[#9191A4]">{displayResult.oracleCount}</span></span>
                      {displayResult.realizedBtcVolPct != null && (
                        <span>
                          Realized BTC vol: <span className="text-[#9191A4]">{displayResult.realizedBtcVolPct.toFixed(1)}%</span>
                          <span className={cn(
                            'ml-1 text-[9px]',
                            displayResult.realizedBtcVolPct < 30 ? 'text-[#3DD68C]' : displayResult.realizedBtcVolPct < 50 ? 'text-[#A9A8EC]' : 'text-[#F04438]',
                          )}>
                            ({displayResult.realizedBtcVolPct < 30 ? 'calm' : displayResult.realizedBtcVolPct < 50 ? 'normal' : 'high'})
                          </span>
                        </span>
                      )}
                    </div>
                  )}
                </div>

                {/* Core metrics */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <MetricBox
                    label="TOTAL RETURN"
                    value={displayResult.metrics.totalReturnPct != null ? formatPct(displayResult.metrics.totalReturnPct) : '—'}
                    color={(displayResult.metrics.totalReturnPct ?? 0) >= 0 ? 'var(--success)' : 'var(--danger)'}
                  />
                  <MetricBox
                    label="ROLLING APY"
                    value={displayResult.metrics.apyPct != null ? formatApy(displayResult.metrics.apyPct) : '—'}
                    sub="modeled flow · see caveat"
                  />
                  <MetricBox
                    label="MAX DRAWDOWN"
                    value={displayResult.metrics.maxDrawdownPct != null ? formatPct(-Math.abs(displayResult.metrics.maxDrawdownPct)) : '—'}
                    color="var(--danger)"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <MetricBox
                    label="WIN RATE"
                    value={displayResult.metrics.winRate != null ? formatPct(displayResult.metrics.winRate * 100) : '—'}
                  />
                  <MetricBox
                    label="SPREAD EATEN"
                    value={displayResult.metrics.spreadCostPct != null ? formatPct(displayResult.metrics.spreadCostPct) : '—'}
                    color="var(--warning)"
                  />
                  <MetricBox
                    label="SHARPE"
                    value={displayResult.metrics.sharpe != null ? displayResult.metrics.sharpe.toFixed(2) : '—'}
                    color={
                      displayResult.metrics.sharpe == null ? undefined
                      : displayResult.metrics.sharpe >= 1 ? '#3DD68C'
                      : displayResult.metrics.sharpe >= 0.3 ? '#A9A8EC'
                      : '#F04438'
                    }
                  />
                </div>

                {/* Risk / caveat banners */}
                {displayResult.riskDisclosure && (
                  <div className="rounded-lg px-4 py-3 text-xs border border-[rgba(240,68,56,0.2)] bg-[rgba(240,68,56,0.05)] text-[#F04438]">
                    <strong>Risk:</strong> {displayResult.riskDisclosure}
                  </div>
                )}

                {displayResult.strategyClass === 'bettor' && displayResult.breakEvenVolPct != null && (
                  <div className="rounded-lg px-4 py-3 text-xs border border-[rgba(232,166,39,0.25)] bg-[rgba(232,166,39,0.06)] text-[#E8A627]">
                    <strong>Break-even vol:</strong> This strategy needs BTC realized vol ≤ <strong>{displayResult.breakEvenVolPct}%</strong> to be profitable.
                    Above that threshold this is negative-EV. Currently shows as calm-regime only.
                  </div>
                )}

                <div className="rounded-lg px-4 py-3 text-xs border border-accent-border bg-accent-muted text-muted-foreground">
                  <strong className="text-accent-light">Note:</strong> {displayResult.caveat}
                </div>

                {/* 1. Cumulative PnL Curve */}
                <BracketCard className="p-6">
                  <div className="text-[10px] tracking-[0.15em] text-accent mb-5">CUMULATIVE NAV (BASE = 100)</div>
                  {displayResult.equityCurve && displayResult.equityCurve.length > 1 ? (
                    <ResultChart data={displayResult.equityCurve} initialCapital={100} />
                  ) : (
                    <div className="h-48 flex items-center justify-center text-sm text-text-dim">
                      Insufficient data points to render chart.
                    </div>
                  )}
                </BracketCard>

                {/* 2. Per-round P&L Distribution */}
                {displayResult.roundResults && displayResult.roundResults.length > 0 && (
                  <BracketCard className="p-6">
                    <div className="mb-5">
                      <SectionHeader icon={BarChart2} label="PER-ROUND P&L DISTRIBUTION" />
                    </div>
                    <PnlDistribution
                      rounds={displayResult.roundResults}
                      strategyClass={displayResult.strategyClass ?? 'house'}
                    />
                  </BracketCard>
                )}

                {/* 3. Regime Breakdown */}
                {displayResult.regimeBreakdown && Object.keys(displayResult.regimeBreakdown).length > 0 && (
                  <div>
                    <div className="text-[10px] tracking-[0.15em] text-accent mb-3">REGIME BREAKDOWN</div>
                    <RegimeTable regimeBreakdown={displayResult.regimeBreakdown} />
                  </div>
                )}

                {/* 4. Vol Regime Stress Test */}
                {displayResult.volStressTest && displayResult.volStressTest.length > 0 && (
                  <BracketCard className="p-6">
                    <div className="mb-5">
                      <SectionHeader icon={TrendingUp} label="VOL REGIME STRESS TEST" />
                    </div>
                    <VolStressChart
                      rows={displayResult.volStressTest}
                      breakEvenVolPct={displayResult.breakEvenVolPct ?? null}
                      strategyClass={displayResult.strategyClass ?? 'house'}
                    />
                  </BracketCard>
                )}

                {/* 5. Utilization Sensitivity */}
                {displayResult.sensitivity && displayResult.sensitivity.length > 0 && (
                  <BracketCard className="p-6">
                    <div className="mb-5">
                      <SectionHeader icon={Sliders} label="UTILIZATION SENSITIVITY" />
                    </div>
                    <SensitivityTable
                      sensitivity={displayResult.sensitivity}
                      strategyClass={displayResult.strategyClass ?? 'house'}
                    />
                  </BracketCard>
                )}
              </motion.div>
            )}

            {displayResult?.status === 'failed' && !isPending && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-xl p-8 text-center border border-danger/20 bg-danger/5"
              >
                <p className="text-sm text-danger">
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
