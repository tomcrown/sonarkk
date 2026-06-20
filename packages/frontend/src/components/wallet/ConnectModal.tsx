import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useConnectWallet, useWallets } from '@mysten/dapp-kit'
import { isEnokiWallet } from '@mysten/enoki'
import { X, Wallet, Loader, AlertCircle, ExternalLink } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'

interface ConnectModalProps {
  open: boolean
  onClose: () => void
}

export function ConnectModal({ open, onClose }: ConnectModalProps) {
  const wallets = useWallets()
  const { mutate: connect } = useConnectWallet()
  const [connecting, setConnecting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const enokiWallets = wallets.filter((w) => isEnokiWallet(w))
  const extensionWallets = wallets.filter((w) => !isEnokiWallet(w))

  function handleConnect(wallet: (typeof wallets)[number]) {
    setConnecting(wallet.name)
    setError(null)
    connect(
      { wallet },
      {
        onSuccess: () => {
          setConnecting(null)
          onClose()
        },
        onError: (err) => {
          setConnecting(null)
          const msg = err instanceof Error ? err.message : String(err)
          // "Popup closed" is user-initiated — don't show as error
          if (!msg.toLowerCase().includes('popup closed') && !msg.toLowerCase().includes('user rejected')) {
            setError(msg)
          }
        },
      },
    )
  }

  function handleClose() {
    if (connecting) return
    setError(null)
    onClose()
  }

  // Render into document.body via a portal so that backdrop-filter on the
  // header (which creates a new containing block in Chrome) cannot affect
  // the position: fixed backdrop and modal — they always fill the viewport.
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm"
            onClick={handleClose}
            aria-hidden
          />

          {/* Centering shell — not animated so flexbox centering is never
              overwritten by Framer Motion's transform-based y animation */}
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            role="dialog"
            aria-modal
            aria-labelledby="connect-modal-title"
          >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-[400px] pointer-events-auto"
          >
            <div className="rounded-2xl overflow-hidden shadow-[0_24px_80px_rgba(0,0,0,0.7)] border border-[rgba(255,255,255,0.07)]"
              style={{ background: '#18181c' }}>

              {/* ── Top bar ─────────────────────────────────────────────── */}
              <div className="flex items-center justify-between px-5 pt-5 pb-0">
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#58586A]">
                  Sonark · Sui Testnet
                </span>
                <button
                  onClick={handleClose}
                  disabled={!!connecting}
                  className="w-7 h-7 flex items-center justify-center rounded-lg text-[#58586A] hover:text-white hover:bg-[rgba(255,255,255,0.06)] transition-colors disabled:opacity-40"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* ── Branding ────────────────────────────────────────────── */}
              <div className="px-5 pt-5 pb-6 text-center">
                <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-[rgba(169,168,236,0.1)] border border-[rgba(169,168,236,0.18)] flex items-center justify-center shadow-[0_0_24px_rgba(169,168,236,0.15)]">
                  <img src="/sonark-logo.png" alt="" className="w-9 h-9 object-contain" aria-hidden />
                </div>
                <h2 id="connect-modal-title" className="text-[17px] font-semibold text-white">
                  Connect to Sonark
                </h2>
                <p className="text-[13px] text-[#58586A] mt-1">
                  Choose how you want to sign in
                </p>
              </div>

              <div className="px-5 pb-5 space-y-4">

                {/* ── Error state ─────────────────────────────────────── */}
                {error && (
                  <div className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 bg-[rgba(240,68,56,0.08)] border border-[rgba(240,68,56,0.2)]">
                    <AlertCircle className="w-4 h-4 text-[#F04438] shrink-0 mt-px" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[#F04438] font-medium">Connection failed</p>
                      <p className="text-[12px] text-[#9f5e5e] mt-0.5 break-words">{error}</p>
                    </div>
                    <button
                      onClick={() => setError(null)}
                      className="shrink-0 text-[#9f5e5e] hover:text-[#F04438] transition-colors mt-px"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {/* ── No wallets at all ───────────────────────────────── */}
                {wallets.length === 0 && (
                  <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] p-5 text-center space-y-3">
                    <div className="w-10 h-10 mx-auto rounded-full bg-[rgba(169,168,236,0.08)] border border-[rgba(169,168,236,0.15)] flex items-center justify-center">
                      <Wallet className="w-5 h-5 text-[#58586A]" />
                    </div>
                    <div>
                      <p className="text-[13px] font-medium text-white">No wallets detected</p>
                      <p className="text-[12px] text-[#58586A] mt-1">Install a Sui wallet to continue</p>
                    </div>
                    <div className="flex flex-col gap-2">
                      <a
                        href="https://slush.app"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-[13px] font-medium bg-[rgba(169,168,236,0.1)] border border-[rgba(169,168,236,0.2)] text-[#A9A8EC] hover:bg-[rgba(169,168,236,0.18)] transition-colors"
                      >
                        Get Slush Wallet <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                      <a
                        href="https://sui.io/wallets"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[12px] text-[#58586A] hover:text-[#9191A4] transition-colors"
                      >
                        See all Sui wallets →
                      </a>
                    </div>
                  </div>
                )}

                {/* ── Social / zkLogin wallets (Enoki) ────────────────── */}
                {enokiWallets.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#3A3A48] px-0.5">
                      Social login
                    </p>
                    {enokiWallets.map((wallet) => (
                      <WalletRow
                        key={wallet.name}
                        name={wallet.name}
                        icon={wallet.icon}
                        badge="zkLogin"
                        connecting={connecting === wallet.name}
                        disabled={!!connecting}
                        onClick={() => handleConnect(wallet)}
                      />
                    ))}
                  </div>
                )}

                {/* Divider — only shown when both sections present */}
                {enokiWallets.length > 0 && extensionWallets.length > 0 && (
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
                    <span className="text-[10px] font-medium uppercase tracking-widest text-[#3A3A48]">or</span>
                    <div className="flex-1 h-px bg-[rgba(255,255,255,0.05)]" />
                  </div>
                )}

                {/* ── Extension wallets ───────────────────────────────── */}
                {extensionWallets.length > 0 && (
                  <div className="space-y-2">
                    {enokiWallets.length > 0 && (
                      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#3A3A48] px-0.5">
                        Browser wallet
                      </p>
                    )}
                    {extensionWallets.map((wallet) => (
                      <WalletRow
                        key={wallet.name}
                        name={wallet.name}
                        icon={wallet.icon}
                        connecting={connecting === wallet.name}
                        disabled={!!connecting}
                        onClick={() => handleConnect(wallet)}
                      />
                    ))}
                  </div>
                )}

                {/* ── Footer ──────────────────────────────────────────── */}
                {wallets.length > 0 && (
                  <div className="pt-1 flex items-center justify-between">
                    <a
                      href="https://slush.app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[11px] text-[#3A3A48] hover:text-[#58586A] transition-colors inline-flex items-center gap-1"
                    >
                      New to Sui? Get Slush <ExternalLink className="w-3 h-3" />
                    </a>
                    <span className="text-[11px] text-[#3A3A48]">Non-custodial</span>
                  </div>
                )}
              </div>
            </div>
          </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ── Shared wallet row ────────────────────────────────────────────────────────

interface WalletRowProps {
  name: string
  icon?: string
  badge?: string
  connecting: boolean
  disabled: boolean
  onClick: () => void
}

function WalletRow({ name, icon, badge, connecting, disabled, onClick }: WalletRowProps) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={[
        'w-full flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition-all duration-150 border outline-none',
        'focus-visible:ring-2 focus-visible:ring-[#A9A8EC] focus-visible:ring-offset-1 focus-visible:ring-offset-[#18181c]',
        connecting
          ? 'border-[rgba(169,168,236,0.3)] bg-[rgba(169,168,236,0.07)] text-white'
          : disabled
            ? 'border-[rgba(255,255,255,0.06)] bg-transparent text-[#9191A4] opacity-40 cursor-not-allowed'
            : 'border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.025)] text-white hover:border-[rgba(169,168,236,0.3)] hover:bg-[rgba(169,168,236,0.07)] active:scale-[0.99] cursor-pointer',
      ].join(' ')}
    >
      {/* Icon */}
      <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center shrink-0 overflow-hidden">
        {icon ? (
          <img src={icon} alt="" className="w-full h-full object-cover" aria-hidden />
        ) : (
          <Wallet className="w-5 h-5 text-[#121213]" />
        )}
      </div>

      {/* Label */}
      <div className="flex-1 text-left">
        <p className="text-[14px] font-medium leading-none">{name}</p>
        {badge && (
          <p className="text-[10px] text-[#58586A] mt-1 font-medium uppercase tracking-wider">{badge}</p>
        )}
      </div>

      {/* Right side: spinner or chevron */}
      {connecting ? (
        <Loader className="w-4 h-4 text-[#A9A8EC] animate-spin shrink-0" />
      ) : (
        <svg className="w-4 h-4 text-[#3A3A48] shrink-0" fill="none" viewBox="0 0 16 16" aria-hidden>
          <path d="M6 4l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}
