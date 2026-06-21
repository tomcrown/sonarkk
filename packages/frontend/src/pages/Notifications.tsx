import { useState, useEffect, useCallback } from 'react'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { Bell, BellOff, CheckCircle2, Copy, ExternalLink, Loader2, Unlink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { BracketCard } from '@/components/common/BracketCard'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

// ── Types ──────────────────────────────────────────────────────────────────────

interface TelegramStatus {
  linked: boolean
  username?: string
  preferences?: {
    notifySupply: boolean
    notifyError: boolean
    notifyNavMilestone: boolean
    notifyPolicyCap: boolean
  }
}

interface LinkCode {
  code: string
  expires_at: string
}

// ── Pref row ──────────────────────────────────────────────────────────────────

function PrefToggle({
  label,
  description,
  checked,
  onChange,
  disabled,
}: {
  label: string
  description: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label className={cn('flex items-start gap-4 py-3 cursor-pointer group', disabled && 'opacity-50 pointer-events-none')}>
      <div className="mt-0.5 shrink-0">
        <div
          onClick={() => onChange(!checked)}
          className={cn(
            'w-10 h-5 rounded-full relative transition-colors duration-200',
            checked ? 'bg-accent' : 'bg-surface-3',
          )}
        >
          <div
            className={cn(
              'absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all duration-200',
              checked ? 'left-5' : 'left-0.5',
            )}
          />
        </div>
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="text-xs text-text-dim mt-0.5">{description}</p>
      </div>
    </label>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function Notifications() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const walletAddress = currentWallet?.accounts[0]?.address

  const [status, setStatus] = useState<TelegramStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [linkCode, setLinkCode] = useState<LinkCode | null>(null)
  const [generatingCode, setGeneratingCode] = useState(false)
  const [copied, setCopied] = useState(false)
  const [unlinking, setUnlinking] = useState(false)
  const [prefSaving, setPrefSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // ── Load initial status ────────────────────────────────────────────────────

  const loadStatus = useCallback(async () => {
    if (!walletAddress) return
    setLoadingStatus(true)
    setError(null)
    try {
      const s = await api.telegram.getStatus(walletAddress)
      setStatus(s)
    } catch {
      setError('Failed to load notification status')
    } finally {
      setLoadingStatus(false)
    }
  }, [walletAddress])

  useEffect(() => {
    if (walletAddress) {
      loadStatus()
    } else {
      setLoadingStatus(false)
    }
  }, [walletAddress, loadStatus])

  // ── Generate link code ─────────────────────────────────────────────────────

  async function generateCode() {
    if (!walletAddress) return
    setGeneratingCode(true)
    setError(null)
    try {
      const result = await api.telegram.getLinkCode(walletAddress)
      setLinkCode(result)
    } catch {
      setError('Failed to generate linking code')
    } finally {
      setGeneratingCode(false)
    }
  }

  // ── Copy code ─────────────────────────────────────────────────────────────

  async function copyCode() {
    if (!linkCode) return
    await navigator.clipboard.writeText(linkCode.code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Unlink ─────────────────────────────────────────────────────────────────

  async function handleUnlink() {
    if (!walletAddress) return
    setUnlinking(true)
    setError(null)
    try {
      await api.telegram.unlink(walletAddress)
      setStatus({ linked: false })
      setLinkCode(null)
    } catch {
      setError('Failed to unlink Telegram account')
    } finally {
      setUnlinking(false)
    }
  }

  // ── Update preferences ─────────────────────────────────────────────────────

  async function updatePref(key: keyof NonNullable<TelegramStatus['preferences']>, value: boolean) {
    if (!walletAddress || !status?.preferences) return
    const newPrefs = { ...status.preferences, [key]: value }
    setStatus(prev => prev ? { ...prev, preferences: newPrefs } : prev)
    setPrefSaving(true)
    try {
      await api.telegram.updatePreferences(walletAddress, { [key]: value })
    } catch {
      // Revert on failure
      setStatus(prev => prev ? { ...prev, preferences: status.preferences } : prev)
      setError('Failed to save preference')
    } finally {
      setPrefSaving(false)
    }
  }

  // ── Poll for link completion ───────────────────────────────────────────────
  // After showing the code, poll every 4s until the wallet gets linked.
  useEffect(() => {
    if (!linkCode || status?.linked || !walletAddress) return
    const interval = setInterval(async () => {
      try {
        const s = await api.telegram.getStatus(walletAddress)
        if (s.linked) {
          setStatus(s)
          setLinkCode(null)
          clearInterval(interval)
        }
      } catch {
        // ignore poll failures
      }
    }, 4000)
    return () => clearInterval(interval)
  }, [linkCode, status?.linked, walletAddress])

  // ── Render ─────────────────────────────────────────────────────────────────

  if (!isConnected || !walletAddress) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="text-center space-y-2">
          <Bell className="w-10 h-10 text-text-dim mx-auto" />
          <p className="text-text-dim">Connect your wallet to manage notifications</p>
        </div>
      </div>
    )
  }

  const prefs = status?.preferences

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8 space-y-8">

        {/* Header */}
        <div>
          <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground">Notifications</h1>
          <p className="mt-1 text-sm text-text-dim">
            Link your Telegram account to receive real-time keeper updates for your portfolios.
          </p>
        </div>

        {/* Error banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="px-4 py-3 rounded-md bg-danger/10 border border-danger/25 text-sm text-danger"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Telegram card */}
        <BracketCard>
          {loadingStatus ? (
            <div className="flex items-center gap-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-text-dim" />
              <span className="text-sm text-text-dim">Loading…</span>
            </div>
          ) : status?.linked ? (
            /* ── LINKED STATE ─────────────────────────────────────────────── */
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-8 h-8 rounded-full bg-success/15 flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-4 h-4 text-success" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Telegram linked</p>
                  {status.username && (
                    <p className="text-xs text-text-dim mt-0.5">@{status.username}</p>
                  )}
                </div>
                <button
                  onClick={handleUnlink}
                  disabled={unlinking}
                  className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:text-danger hover:bg-danger/10 transition-colors disabled:opacity-50"
                >
                  {unlinking ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Unlink className="w-3 h-3" />
                  )}
                  Unlink
                </button>
              </div>

              {/* Preference divider */}
              <div className="border-t border-border pt-4">
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs tracking-widest text-text-dim font-medium uppercase">Notification preferences</p>
                  {prefSaving && <Loader2 className="w-3 h-3 animate-spin text-text-dim" />}
                </div>
                <div className="divide-y divide-border/50">
                  <PrefToggle
                    label="Keeper cycles"
                    description="Supply, settle, and hedge executions"
                    checked={prefs?.notifySupply ?? true}
                    onChange={v => updatePref('notifySupply', v)}
                  />
                  <PrefToggle
                    label="Errors"
                    description="When the keeper encounters a failure on your portfolio"
                    checked={prefs?.notifyError ?? true}
                    onChange={v => updatePref('notifyError', v)}
                  />
                  <PrefToggle
                    label="NAV milestones"
                    description="When your portfolio NAV crosses a significant threshold"
                    checked={prefs?.notifyNavMilestone ?? false}
                    onChange={v => updatePref('notifyNavMilestone', v)}
                  />
                  <PrefToggle
                    label="Policy cap events"
                    description="When the keeper policy cap is approaching its limit or expires"
                    checked={prefs?.notifyPolicyCap ?? true}
                    onChange={v => updatePref('notifyPolicyCap', v)}
                  />
                </div>
              </div>
            </div>
          ) : (
            /* ── NOT LINKED STATE ─────────────────────────────────────────── */
            <div className="space-y-5">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center shrink-0">
                  <BellOff className="w-4 h-4 text-text-dim" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">No Telegram account linked</p>
                  <p className="text-xs text-text-dim mt-0.5">Link your account to receive keeper notifications directly in Telegram.</p>
                </div>
              </div>

              <AnimatePresence mode="wait">
                {!linkCode ? (
                  <motion.div key="cta" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <button
                      onClick={generateCode}
                      disabled={generatingCode}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-md bg-accent/15 hover:bg-accent/25 text-accent-light text-sm font-medium transition-colors disabled:opacity-50"
                    >
                      {generatingCode ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Bell className="w-4 h-4" />
                      )}
                      {generatingCode ? 'Generating…' : 'Generate linking code'}
                    </button>
                  </motion.div>
                ) : (
                  <motion.div
                    key="code"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="space-y-4"
                  >
                    {/* Steps */}
                    <ol className="space-y-3 text-sm">
                      <li className="flex items-start gap-2.5">
                        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[11px] font-semibold text-accent-light">1</span>
                        <span className="text-text-dim">
                          Open{' '}
                          <a
                            href="https://t.me/SonarkBot"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-accent-light hover:underline inline-flex items-center gap-0.5"
                          >
                            @SonarkBot <ExternalLink className="w-3 h-3" />
                          </a>
                          {' '}on Telegram
                        </span>
                      </li>
                      <li className="flex items-start gap-2.5">
                        <span className="shrink-0 mt-0.5 w-5 h-5 rounded-full bg-accent/20 flex items-center justify-center text-[11px] font-semibold text-accent-light">2</span>
                        <span className="text-text-dim">Send this code to the bot:</span>
                      </li>
                    </ol>

                    {/* Code display */}
                    <div className="flex items-center gap-3 px-4 py-3 rounded-md bg-surface-2 border border-border">
                      <code className="flex-1 text-lg font-mono font-semibold text-foreground tracking-widest">
                        {linkCode.code}
                      </code>
                      <button
                        onClick={copyCode}
                        className="shrink-0 p-1.5 rounded text-text-dim hover:text-foreground hover:bg-surface-3 transition-colors"
                        title="Copy code"
                      >
                        {copied ? (
                          <CheckCircle2 className="w-4 h-4 text-success" />
                        ) : (
                          <Copy className="w-4 h-4" />
                        )}
                      </button>
                    </div>

                    {/* Expiry + polling indicator */}
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3 h-3 animate-spin text-text-dim" />
                      <p className="text-xs text-text-dim">
                        Waiting for you to send the code to the bot…
                        {' '}Code expires at{' '}
                        {new Date(linkCode.expires_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                      </p>
                    </div>

                    {/* Regenerate */}
                    <button
                      onClick={generateCode}
                      disabled={generatingCode}
                      className="text-xs text-text-dim hover:text-muted-foreground underline-offset-2 hover:underline transition-colors disabled:opacity-50"
                    >
                      Generate a new code
                    </button>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </BracketCard>

        {/* Info section */}
        <div className="space-y-3">
          <p className="text-xs tracking-widest text-text-dim font-medium uppercase">What you'll receive</p>
          <div className="grid sm:grid-cols-2 gap-3">
            {[
              { icon: '✅', label: 'Cycle executed', desc: 'When supply, settle, or hedge runs on your portfolio' },
              { icon: '⚠️', label: 'Keeper error', desc: 'If the keeper hits a failure that needs attention' },
              { icon: '📈', label: 'NAV milestone', desc: 'When your portfolio crosses a meaningful return threshold' },
              { icon: '🔑', label: 'Policy cap', desc: 'When the keeper policy cap nears its limit or needs renewal' },
            ].map(item => (
              <div
                key={item.label}
                className="flex items-start gap-3 px-4 py-3 rounded-md bg-card border border-border"
              >
                <span className="text-base leading-none mt-0.5">{item.icon}</span>
                <div>
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <p className="text-xs text-text-dim mt-0.5">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
