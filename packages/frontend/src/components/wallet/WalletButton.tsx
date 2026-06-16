import { useState } from 'react'
import { useCurrentWallet, useDisconnectWallet } from '@mysten/dapp-kit'
import { Wallet, LogOut, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectModal } from './ConnectModal'
import { truncateAddress } from '@/lib/format'

export function WalletButton() {
  const { currentWallet, isConnected } = useCurrentWallet()
  const { mutate: disconnect } = useDisconnectWallet()
  const [showModal, setShowModal] = useState(false)
  const [showMenu, setShowMenu] = useState(false)

  if (!isConnected) {
    return (
      <>
        <Button
          variant="pill-outline"
          size="sm"
          onClick={() => setShowModal(true)}
          className="text-xs tracking-widest uppercase font-semibold"
        >
          <Wallet className="w-3.5 h-3.5" />
          Connect Wallet
        </Button>
        <ConnectModal open={showModal} onClose={() => setShowModal(false)} />
      </>
    )
  }

  const address = currentWallet?.accounts[0]?.address ?? ''

  return (
    <div className="relative">
      <button
        onClick={() => setShowMenu((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-[rgba(169,168,236,0.3)] bg-[rgba(169,168,236,0.08)] px-3 py-1.5 text-xs font-medium text-white transition-all hover:bg-[rgba(169,168,236,0.15)] hover:border-[rgba(169,168,236,0.5)]"
        aria-label="Wallet menu"
        aria-expanded={showMenu}
      >
        <div className="w-2 h-2 rounded-full bg-[#3DD68C] shadow-[0_0_6px_rgba(34,197,94,0.6)]" aria-hidden />
        <span className="font-mono">{truncateAddress(address)}</span>
        <ChevronDown className={`w-3 h-3 text-[#9191A4] transition-transform ${showMenu ? 'rotate-180' : ''}`} />
      </button>

      {showMenu && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} aria-hidden />
          <div className="absolute right-0 top-full mt-2 z-20 w-48 rounded-lg border border-[rgba(169,168,236,0.2)] bg-[#242429] shadow-xl overflow-hidden">
            <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.06)]">
              <p className="text-xs text-[#58586A]">Connected via</p>
              <p className="text-xs font-medium text-white">{currentWallet?.name ?? 'Wallet'}</p>
            </div>
            <button
              onClick={() => { disconnect(); setShowMenu(false) }}
              className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-[#9191A4] hover:bg-[rgba(239,68,68,0.08)] hover:text-[#F47C72] transition-colors"
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
