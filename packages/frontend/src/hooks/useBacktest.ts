import { useState, useCallback } from 'react'
import { api, type BacktestResult } from '@/lib/api'

export interface RunRecord extends BacktestResult {
  status: 'completed' | 'failed'
  strategyType: number
  timeframe: string
  error?: string
}

export function useBacktest() {
  const [isPending, setIsPending] = useState(false)
  const [progress, setProgress] = useState(0)
  const [runHistory, setRunHistory] = useState<RunRecord[]>([])

  const mutate = useCallback(
    async (
      vars: { strategyType: number; timeframe: string },
      opts?: {
        onSuccess?: (result: RunRecord) => void
        onError?: (err: Error) => void
      },
    ) => {
      setIsPending(true)
      setProgress(0)

      // Simulate progress increments while the API is running
      const ticker = setInterval(() => {
        setProgress((p) => Math.min(p + Math.random() * 12, 88))
      }, 400)

      try {
        const result = await api.backtest.run({
          strategyType: vars.strategyType,
          timeframe: vars.timeframe,
        })

        clearInterval(ticker)
        setProgress(100)

        const record: RunRecord = {
          ...result,
          status: 'completed',
          strategyType: vars.strategyType,
          timeframe: vars.timeframe,
        }

        setRunHistory((prev) => [record, ...prev].slice(0, 20))
        opts?.onSuccess?.(record)
      } catch (err) {
        clearInterval(ticker)
        setProgress(0)

        const error = err instanceof Error ? err : new Error('Backtest failed')
        const failRecord: RunRecord = {
          metrics: {
            strategyType: vars.strategyType,
            apyPct: 0,
            rollingApyPct: 0,
            sharpe: null,
            maxDrawdownPct: 0,
            winRate: 0,
            spreadCostPct: 0,
            spreadEatenPct: 0,
            totalReturnPct: 0,
            cycleCount: 0,
          },
          equityCurve: [],
          pnlCurve: [],
          roundResults: [],
          regimeBreakdown: {},
          sensitivity: [],
          volStressTest: [],
          breakEvenVolPct: null,
          periodStart: new Date().toISOString(),
          periodEnd: new Date().toISOString(),
          oracleCount: 0,
          realizedBtcVolPct: null,
          strategyClass: 'house',
          riskDisclosure: null,
          caveat: '',
          status: 'failed',
          strategyType: vars.strategyType,
          timeframe: vars.timeframe,
          error: error.message,
        }

        setRunHistory((prev) => [failRecord, ...prev].slice(0, 20))
        opts?.onError?.(error)
      } finally {
        setIsPending(false)
      }
    },
    [],
  )

  return { mutate, isPending, progress, runHistory }
}
