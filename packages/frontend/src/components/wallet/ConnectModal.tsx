import { useConnectWallet, useWallets } from '@mysten/dapp-kit'
import { X, Wallet, Chrome } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'

interface ConnectModalProps {
  open: boolean
  onClose: () => void
}

export function ConnectModal({ open, onClose }: ConnectModalProps) {
  const wallets = useWallets()
  const { mutate: connect, isPending } = useConnectWallet()

  // zkLogin handler — requires Enoki API key
  const handleZkLogin = () => {
    // VITE_ENOKI_API_KEY and VITE_GOOGLE_CLIENT_ID must be set in .env
    // See packages/frontend/.env.example
    const apiKey = import.meta.env.VITE_ENOKI_API_KEY
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID

    if (!apiKey || apiKey === 'REPLACE_WITH_ENOKI_API_KEY' || !clientId || clientId === 'REPLACE_WITH_GOOGLE_CLIENT_ID') {
      alert('zkLogin is not configured. Set VITE_ENOKI_API_KEY and VITE_GOOGLE_CLIENT_ID in packages/frontend/.env')
      return
    }

    // Build the OAuth URL via Enoki redirect pattern
    const redirectUrl = `${window.location.origin}/auth/callback`
    const params = new URLSearchParams({
      response_type: 'id_token',
      client_id: clientId,
      redirect_uri: redirectUrl,
      scope: 'openid email',
      nonce: btoa(String(Date.now())), // ephemeral nonce — production would use Enoki's nonce
    })
    window.location.href = `https://accounts.google.com/o/oauth2/v2/auth?${params}`
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 8 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 w-full max-w-sm"
            role="dialog"
            aria-modal
            aria-labelledby="connect-modal-title"
          >
            <div className="rounded-2xl border border-[rgba(169,168,236,0.25)] bg-[#242429] shadow-2xl overflow-hidden">
              {/* Header */}
              <div className="px-6 pt-6 pb-4 flex items-center justify-between">
                <div>
                  <h2 id="connect-modal-title" className="text-base font-semibold text-white">
                    Connect to Sonark
                  </h2>
                  <p className="text-xs text-[#58586A] mt-0.5">Choose how you want to connect</p>
                </div>
                <button
                  onClick={onClose}
                  className="w-7 h-7 flex items-center justify-center rounded-md text-[#58586A] hover:text-white hover:bg-[rgba(255,255,255,0.06)] transition-colors"
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="px-6 pb-6 space-y-3">
                {/* zkLogin */}
                <button
                  onClick={handleZkLogin}
                  className="w-full flex items-center gap-3 rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03] px-4 py-3.5 text-sm text-white hover:border-[rgba(169,168,236,0.35)] hover:bg-[rgba(169,168,236,0.06)] transition-all"
                >
                  <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center shrink-0">
                    <Chrome className="w-4 h-4 text-[#4285f4]" />
                  </div>
                  <div className="text-left">
                    <p className="font-medium">Sign in with Google</p>
                    <p className="text-[10px] text-[#58586A] mt-0.5">No wallet extension needed · zkLogin</p>
                  </div>
                </button>

                <div className="flex items-center gap-3">
                  <Separator className="flex-1" />
                  <span className="text-[10px] text-[#58586A] uppercase tracking-wider">or wallet</span>
                  <Separator className="flex-1" />
                </div>

                {/* Installed wallets */}
                {wallets.length === 0 ? (
                  <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-4 text-center">
                    <Wallet className="w-5 h-5 text-[#58586A] mx-auto mb-2" />
                    <p className="text-sm text-[#58586A]">No wallets detected</p>
                    <a
                      href="https://slush.app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#A9A8EC] hover:underline mt-1 inline-block"
                    >
                      Get Slush Wallet →
                    </a>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {wallets.map((wallet) => (
                      <button
                        key={wallet.name}
                        disabled={isPending}
                        onClick={() =>
                          connect(
                            { wallet },
                            { onSuccess: onClose },
                          )
                        }
                        className="w-full flex items-center gap-3 rounded-xl border border-[rgba(255,255,255,0.1)] bg-white/[0.03] px-4 py-3 text-sm text-white hover:border-[rgba(169,168,236,0.35)] hover:bg-[rgba(169,168,236,0.06)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {wallet.icon && (
                          <img src={wallet.icon} alt="" className="w-7 h-7 rounded-lg" aria-hidden />
                        )}
                        <span className="font-medium">{wallet.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
