import { useRef, useEffect, useState } from 'react'
import { useCurrentWallet, useCurrentAccount } from '@mysten/dapp-kit'
import { Sparkles, Plus, History, Send } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChat } from '@/hooks/useChat'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { ChatInput } from '@/components/chat/ChatInput'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import { Button } from '@/components/ui/button'
import { ConnectModal } from '@/components/wallet/ConnectModal'

const SUGGESTIONS = [
  "What's the current BTC implied vol?",
  'Explain how my PLP Supplier strategy earns',
  "Should I run a Range Roll in today's conditions?",
  'What is the spread formula for ATM strikes?',
]

export default function Copilot() {
  const { isConnected } = useCurrentWallet()
  const account = useCurrentAccount()
  const { messages, isStreaming, error, sendMessage, clearMessages } = useChat(account?.address)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showConnectModal, setShowConnectModal] = useState(false)

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isStreaming])

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 sm:px-6 lg:px-10 pt-6 lg:pt-10 pb-4 border-b border-border">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <div className="text-xs tracking-[0.2em] text-text-dim mb-2">AI</div>
            <h1 className="text-4xl font-display font-medium tracking-tight uppercase">Copilot</h1>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" className="inline-flex items-center gap-2 text-sm">
              <History className="w-3.5 h-3.5" /> History
            </Button>
            <Button variant="outline" size="sm" onClick={clearMessages} className="inline-flex items-center gap-2 text-sm text-accent-light">
              <Plus className="w-3.5 h-3.5" /> New
            </Button>
            {!isConnected && (
              <Button size="sm" variant="pill" onClick={() => setShowConnectModal(true)} className="text-xs">
                Connect wallet
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-8">
        {isEmpty ? (
          <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#A9A8EC] to-[#7B79D9] flex items-center justify-center mb-5 shadow-[0_0_24px_rgba(169,168,236,0.3)]">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-display mb-2 text-white">
              {isConnected ? 'Ask me anything' : 'Your Sonark Copilot'}
            </h2>
            <p className="text-[13px] text-[#58586A] mb-7 max-w-sm leading-relaxed">
              {isConnected
                ? 'I have live access to your portfolio, market conditions, and the leaderboard.'
                : 'Connect your wallet to get personalised advice using your live portfolio data.'}
            </p>
            {!isConnected && (
              <Button onClick={() => setShowConnectModal(true)} variant="pill" size="sm" className="mb-7">
                Connect wallet
              </Button>
            )}
            <div className="grid grid-cols-2 gap-2 w-full">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="text-left px-4 py-3 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.07)] rounded-xl text-[13px] text-[#9191A4] hover:border-[rgba(169,168,236,0.3)] hover:text-white hover:bg-[rgba(169,168,236,0.05)] transition-all duration-150"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-6">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.18 }}
                >
                  <ChatMessage message={msg} />
                </motion.div>
              ))}
              {isStreaming && messages.at(-1)?.role === 'user' && (
                <motion.div key="typing" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}>
                  <TypingIndicator />
                </motion.div>
              )}
            </AnimatePresence>
            {error && (
              <div className="text-[12px] text-[#F47C72] bg-[rgba(240,68,56,0.07)] border border-[rgba(240,68,56,0.18)] rounded-xl px-4 py-3">
                {error} — make sure the API server is running.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input bar */}
      <div className="border-t border-border px-4 sm:px-6 lg:px-10 py-4 lg:py-5 shrink-0">
        <div className="max-w-3xl mx-auto">
          <ChatInput
            onSend={sendMessage}
            disabled={isStreaming}
            placeholder={isConnected ? 'Ask about your portfolio...' : 'Ask anything — connect wallet for portfolio context...'}
          />
          <div className="flex items-center justify-between mt-3 text-[10px] tracking-wider text-text-dim font-mono">
            <span>USES YOUR AUTHORIZED SONARK DATA</span>
            <span>{isEmpty ? 'NO CONVERSATION SELECTED' : `${messages.length} MESSAGES`}</span>
          </div>
        </div>
      </div>

      <ConnectModal open={showConnectModal} onClose={() => setShowConnectModal(false)} />
    </div>
  )
}
