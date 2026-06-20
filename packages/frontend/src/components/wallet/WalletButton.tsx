import { useState, useRef } from 'react'
import { useCurrentWallet, useDisconnectWallet } from '@mysten/dapp-kit'
import { isGoogleWallet } from '@mysten/enoki'
import { LogOut, ChevronDown, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectModal } from './ConnectModal'
import { truncateAddress } from '@/lib/format'

// Inline Google G SVG — avoids a lucide icon mismatch
function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  )
}

export function WalletButton() {
  const { currentWallet, isConnected } = useCurrentWallet()
  const { mutate: disconnect } = useDisconnectWallet()
  const [showModal, setShowModal] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  if (!isConnected) {
    return (
      <>
        <Button
          variant="pill-outline"
          size="sm"
          onClick={() => setShowModal(true)}
          className="text-xs tracking-widest uppercase font-semibold"
        >
          Connect Wallet
        </Button>
        <ConnectModal open={showModal} onClose={() => setShowModal(false)} />
      </>
    )
  }

  const address = currentWallet?.accounts[0]?.address ?? ''
  const isGoogle = currentWallet ? isGoogleWallet(currentWallet) : false

  function copyAddress() {
    void navigator.clipboard.writeText(address)
    setCopied(true)
    if (copyTimer.current) clearTimeout(copyTimer.current)
    copyTimer.current = setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-[rgba(169,168,236,0.25)] bg-[rgba(169,168,236,0.07)] px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-[rgba(169,168,236,0.13)] hover:border-[rgba(169,168,236,0.45)]"
        aria-label="Wallet menu"
        aria-expanded={showMenu}
      >
        <span className="w-2 h-2 rounded-full bg-[#3DD68C] shadow-[0_0_6px_rgba(61,214,140,0.5)]" aria-hidden />
        <span className="font-mono text-[11px]">{truncateAddress(address)}</span>
        <ChevronDown className={`w-3 h-3 text-[#58586A] transition-transform duration-150 ${showMenu ? 'rotate-180' : ''}`} />
      </button>

      {showMenu && (
        <>
          {/* Click-away overlay */}
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} aria-hidden />

          {/* Dropdown */}
          <div className="absolute right-0 top-full mt-2 z-20 w-56 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[#1c1c21] shadow-[0_16px_48px_rgba(0,0,0,0.6)] overflow-hidden">

            {/* Connected-via header */}
            <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.05)]">
              <div className="flex items-center gap-2 mb-0.5">
                {isGoogle
                  ? <GoogleIcon className="w-3.5 h-3.5 shrink-0" />
                  : currentWallet?.icon
                    ? <img src={currentWallet.icon} alt="" className="w-3.5 h-3.5 rounded-sm shrink-0" aria-hidden />
                    : null
                }
                <p className="text-[11px] font-medium text-[#9191A4]">
                  {isGoogle ? 'Google · zkLogin' : (currentWallet?.name ?? 'Wallet')}
                </p>
              </div>
              <p className="text-[12px] font-mono text-white truncate">{truncateAddress(address)}</p>
            </div>

            {/* Copy address */}
            <button
              onClick={copyAddress}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#9191A4] hover:bg-[rgba(255,255,255,0.04)] hover:text-white transition-colors"
            >
              {copied
                ? <Check className="w-3.5 h-3.5 text-[#3DD68C]" />
                : <Copy className="w-3.5 h-3.5" />
              }
              {copied ? 'Copied!' : 'Copy address'}
            </button>

            {/* Divider */}
            <div className="h-px bg-[rgba(255,255,255,0.05)]" />

            {/* Disconnect */}
            <button
              onClick={() => { disconnect(); setShowMenu(false) }}
              className="flex w-full items-center gap-2.5 px-4 py-2.5 text-[13px] text-[#9191A4] hover:bg-[rgba(239,68,68,0.07)] hover:text-[#F47C72] transition-colors"
            >
              <LogOut className="w-3.5 h-3.5" />
              Disconnect
            </button>
          </div>
        </>
      )}
    </div>
  )
}
