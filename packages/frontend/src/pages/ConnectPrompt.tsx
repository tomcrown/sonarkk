import { useState } from 'react'
import { Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ConnectModal } from '@/components/wallet/ConnectModal'

interface ConnectPromptProps {
  title: string
  description: string
}

export function ConnectPrompt({ title, description }: ConnectPromptProps) {
  const [showModal, setShowModal] = useState(false)

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">
          {title}
        </p>
        <h1 className="text-2xl font-semibold text-white">{title}</h1>
      </div>

      <div className="rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#1C1C21] p-8 flex flex-col items-center text-center gap-5">
        <div className="w-12 h-12 rounded-full bg-[rgba(169,168,236,0.12)] border border-[rgba(169,168,236,0.2)] flex items-center justify-center">
          <Wallet className="w-5 h-5 text-[#A9A8EC]" />
        </div>
        <div>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[#9191A4] mb-1">
            Sign in required
          </h2>
          <p className="text-sm text-[#58586A] max-w-sm">{description}</p>
        </div>
        <Button
          variant="pill-outline"
          onClick={() => setShowModal(true)}
          className="rounded-full px-5 py-2.5 h-auto text-xs tracking-widest uppercase font-semibold shadow-none hover:shadow-none"
        >
          <Wallet className="w-3.5 h-3.5" />
          Connect Wallet
        </Button>
      </div>

      <ConnectModal open={showModal} onClose={() => setShowModal(false)} />
    </div>
  )
}
