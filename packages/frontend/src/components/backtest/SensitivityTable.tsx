/**
 * Utilization Sensitivity Table
 *
 * Shows APY, Max Drawdown, and Sharpe at the three canonical util levels
 * (5% / 25% / 60%). Demonstrates that house strategies scale well;
 * bettor strategies amplify both gain and drawdown linearly.
 */
import { type SensitivityPoint } from '@/lib/api'

interface SensitivityTableProps {
  sensitivity: SensitivityPoint[]
  strategyClass: 'house' | 'bettor'
}

function SharpeChip({ value }: { value: number }) {
  const color = value >= 1 ? '#3DD68C' : value >= 0.3 ? '#A9A8EC' : '#F04438'
  return (
    <span
      className="text-[10px] font-semibold px-1.5 py-0.5 rounded font-mono"
      style={{ color, background: `${color}1a`, border: `1px solid ${color}33` }}
    >
      {value.toFixed(2)}
    </span>
  )
}

export function SensitivityTable({ sensitivity, strategyClass }: SensitivityTableProps) {
  if (!sensitivity || sensitivity.length === 0) {
    return <p className="text-sm text-[#58586A]">Sensitivity data unavailable.</p>
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-[#58586A]">
        Same strategy, three utilization levels. Shows how position sizing affects
        return and risk — useful for choosing an appropriate deployment size.
      </p>
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[rgba(255,255,255,0.03)] border-b border-[rgba(255,255,255,0.06)]">
              <th className="px-4 py-2.5 text-left  text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Utilization</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">APY</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Max DD</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Win Rate</th>
              <th className="px-4 py-2.5 text-left  text-[10px] font-semibold uppercase tracking-wider text-[#58586A]">Sharpe</th>
            </tr>
          </thead>
          <tbody>
            {sensitivity.map((row) => {
              const apyPositive = row.netApyPct >= 0
              const utilLabel = row.utilPct === 5 ? 'Conservative (5%)' : row.utilPct === 25 ? 'Balanced (25%)' : 'Aggressive (60%)'
              return (
                <tr
                  key={row.utilPct}
                  className="border-b border-[rgba(255,255,255,0.04)] last:border-0 hover:bg-[rgba(255,255,255,0.015)] transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="text-[#9191A4] text-xs">{utilLabel}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={`font-semibold font-mono text-sm ${apyPositive ? 'text-[#3DD68C]' : 'text-[#F04438]'}`}>
                      {row.netApyPct >= 0 ? '+' : ''}{row.netApyPct.toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm text-[#F04438]">
                      −{Math.abs(row.maxDrawdownPct).toFixed(1)}%
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className="font-mono text-sm text-[#9191A4]">
                      {row.winRatePct != null ? `${row.winRatePct.toFixed(1)}%` : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <SharpeChip value={row.sharpe} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-[#58586A]">
        {strategyClass === 'house'
          ? 'Higher utilization = more capital exposed per round = proportionally higher spread income and APY. Drawdown scales linearly.'
          : 'Higher utilization = larger bets. Bettor strategy gains and losses both amplify. Sharpe should remain stable if strategy has genuine edge.'}
      </p>
    </div>
  )
}
