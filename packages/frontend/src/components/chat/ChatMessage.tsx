import { useNavigate } from 'react-router-dom'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowRight, Shield, Zap } from 'lucide-react'
import { type ChatMessage as ChatMessageType } from '@/lib/api'
import { STRATEGY_NAMES, BETTOR_STRATEGIES } from '@/lib/constants'
import { cn } from '@/lib/cn'

// ── Sonark action payload (matches what Claude outputs) ───────────────────────

export interface SonarkAction {
  strategy_type: number
  strategy_name: string
  util_target: string
  liquidity_reserve_pct: string
  drawdown_pause_threshold_pct: string
  strike_selection: string
  vol_target_bps: string
  hedge_multiplier: string
  reason: string
}

// ── Action card — "Configure this →" ─────────────────────────────────────────

function DeployActionCard({ action }: { action: SonarkAction }) {
  const navigate = useNavigate()
  const isBettor = BETTOR_STRATEGIES.has(action.strategy_type)
  const name = STRATEGY_NAMES[action.strategy_type] ?? action.strategy_name

  function handleConfigure() {
    sessionStorage.setItem('sonark_prefill', JSON.stringify(action))
    navigate('/explore')
  }

  const settings: [string, string][] = [
    ['Utilization', `${(parseFloat(action.util_target) * 100).toFixed(0)}% per cycle`],
    ['Reserve', `${(parseFloat(action.liquidity_reserve_pct) * 100).toFixed(0)}% held back`],
    ['Drawdown pause', action.drawdown_pause_threshold_pct === '0'
      ? 'Disabled'
      : `Pause at −${(parseFloat(action.drawdown_pause_threshold_pct) * 100).toFixed(0)}%`],
    ...(action.strategy_type === 1 ? [['Hedge', `${action.hedge_multiplier}× delta`] as [string, string]] : []),
    ...(isBettor && action.strike_selection !== 'ATM' ? [['Strike', action.strike_selection] as [string, string]] : []),
    ...(action.strategy_type === 5 ? [['Vol target', `${(parseInt(action.vol_target_bps) / 100).toFixed(0)}%`] as [string, string]] : []),
  ]

  return (
    <div className="mt-3 rounded-xl border border-[rgba(169,168,236,0.22)] bg-[rgba(169,168,236,0.04)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[rgba(169,168,236,0.12)]">
        <div className={cn(
          'w-6 h-6 rounded-md flex items-center justify-center shrink-0',
          isBettor
            ? 'bg-[rgba(232,166,39,0.15)] text-[#E8A627]'
            : 'bg-[rgba(169,168,236,0.15)] text-[#A9A8EC]',
        )}>
          {isBettor
            ? <Zap className="w-3.5 h-3.5" />
            : <Shield className="w-3.5 h-3.5" />
          }
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-white leading-none">{name}</p>
          <p className="text-[10px] text-[#58586A] mt-0.5 font-medium uppercase tracking-wider">
            {isBettor ? 'Bettor · Short-vol' : 'House · Spread collector'}
          </p>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#A9A8EC] bg-[rgba(169,168,236,0.1)] px-2 py-0.5 rounded-full">
          Recommended
        </span>
      </div>

      {/* Reason */}
      <p className="px-4 py-2.5 text-[12.5px] text-[#9191A4] leading-relaxed border-b border-[rgba(255,255,255,0.04)]">
        {action.reason}
      </p>

      {/* Settings grid */}
      <div className="grid grid-cols-3 divide-x divide-[rgba(255,255,255,0.04)] border-b border-[rgba(255,255,255,0.04)]">
        {settings.slice(0, 3).map(([k, v]) => (
          <div key={k} className="px-3 py-2.5">
            <p className="text-[10px] text-[#58586A] font-medium uppercase tracking-wider mb-0.5">{k}</p>
            <p className="text-[12px] text-white font-medium">{v}</p>
          </div>
        ))}
      </div>
      {settings.length > 3 && (
        <div className="grid grid-cols-3 divide-x divide-[rgba(255,255,255,0.04)] border-b border-[rgba(255,255,255,0.04)]">
          {settings.slice(3).map(([k, v]) => (
            <div key={k} className="px-3 py-2.5">
              <p className="text-[10px] text-[#58586A] font-medium uppercase tracking-wider mb-0.5">{k}</p>
              <p className="text-[12px] text-white font-medium">{v}</p>
            </div>
          ))}
        </div>
      )}

      {/* CTA */}
      <button
        onClick={handleConfigure}
        className="w-full flex items-center justify-between px-4 py-3 text-[13px] font-medium text-[#A9A8EC] hover:bg-[rgba(169,168,236,0.07)] transition-colors group"
      >
        <span>Configure and deploy this strategy</span>
        <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
      </button>
    </div>
  )
}

// ── Markdown component overrides ──────────────────────────────────────────────

function buildComponents(isMounted: boolean): Components {
  return {
    // Block code: pre wraps code — detect sonark-action here before adding <pre>
    pre({ children }) {
      // children is the <code> element rendered by react-markdown
      const codeEl = children as React.ReactElement<{ className?: string; children?: React.ReactNode }>
      if (codeEl?.props?.className === 'language-sonark-action') {
        if (!isMounted) return null
        const raw = String(codeEl.props.children ?? '').trim()
        try {
          return <DeployActionCard action={JSON.parse(raw) as SonarkAction} />
        } catch {
          return null
        }
      }
      return (
        <pre className="bg-[rgba(0,0,0,0.35)] border border-[rgba(255,255,255,0.07)] rounded-lg px-3.5 py-3 overflow-x-auto my-3 text-[12px] text-[#C4C3F5] font-mono">
          {children}
        </pre>
      )
    },
    code({ className, children, ...props }) {
      // Inline code only (block code is handled in pre above)
      if (!className) {
        return (
          <code className="font-mono text-[12px] bg-[rgba(169,168,236,0.1)] border border-[rgba(169,168,236,0.18)] text-[#C4C3F5] rounded px-1 py-px" {...props}>
            {children}
          </code>
        )
      }
      // Block code content — pre handles the wrapper
      return <code className={className} {...props}>{children}</code>
    },
    table({ children }) {
      return (
        <div className="overflow-x-auto my-3">
          <table className="w-full text-[13px] border-collapse">{children}</table>
        </div>
      )
    },
  }
}

// ── Message component ─────────────────────────────────────────────────────────

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-2xl rounded-br-sm bg-[#A9A8EC] px-4 py-2.5 text-[14px] leading-relaxed text-white">
          {message.content}
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#A9A8EC] to-[#7B79D9] flex items-center justify-center shrink-0 mt-1 shadow-[0_0_10px_rgba(169,168,236,0.35)]">
        <svg className="w-3.5 h-3.5 text-white" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M8 2L9.5 6.5H14L10.5 9L12 13.5L8 11L4 13.5L5.5 9L2 6.5H6.5L8 2Z" fill="currentColor" />
        </svg>
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pt-0.5">
        {message.content && (
          <div className="prose-chat">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={buildComponents(true)}
            >
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
