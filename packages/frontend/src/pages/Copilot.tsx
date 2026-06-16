import { useRef, useEffect } from 'react'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { MessageSquare, Plus, History } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { useChat } from '@/hooks/useChat'
import { ChatMessage } from '@/components/chat/ChatMessage'
import { ChatInput } from '@/components/chat/ChatInput'
import { TypingIndicator } from '@/components/chat/TypingIndicator'
import { Button } from '@/components/ui/button'
import { ConnectModal } from '@/components/wallet/ConnectModal'
import { useState } from 'react'

const SUGGESTIONS = [
  'What\'s the current BTC implied vol?',
  'Explain how my PLP Supplier strategy earns',
  'Should I run a Range Roll in today\'s conditions?',
  'What is the spread formula for ATM strikes?',
]

export default function Copilot() {
  const { isConnected } = useCurrentWallet()
  const { messages, isStreaming, error, sendMessage, clearMessages } = useChat()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [showConnectModal, setShowConnectModal] = useState(false)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, isStreaming])

  const isEmpty = messages.length === 0

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)]">
      {/* Header bar */}
      <div className="flex items-center justify-between pb-4 border-b border-[rgba(255,255,255,0.06)] mb-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#A9A8EC] flex items-center justify-center shadow-[0_0_12px_rgba(169,168,236,0.4)]">
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-[#58586A]">Sonark Copilot</p>
            <p className="text-sm font-semibold text-white">
              {isEmpty ? 'New conversation' : `${messages.length} messages`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" className="text-xs gap-1.5">
            <History className="w-3.5 h-3.5" /> History
          </Button>
          <Button variant="outline" size="sm" onClick={clearMessages} className="text-xs gap-1.5">
            <Plus className="w-3.5 h-3.5" /> New
          </Button>
          {!isConnected && (
            <Button size="sm" variant="pill" onClick={() => setShowConnectModal(true)} className="text-xs">
              Connect wallet
            </Button>
          )}
        </div>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto py-6">
        {isEmpty ? (
          /* Empty state — centered CTA */
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            {!isConnected && (
              <div className="mb-6">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[#58586A] mb-3">
                  Private account context
                </p>
                <h2 className="text-2xl font-semibold text-white mb-2">Pick up where you left off</h2>
                <p className="text-sm text-[#9191A4] max-w-sm">
                  Connect your wallet to chat with Copilot using your live portfolio data, keep conversations, and come back to them anytime.
                </p>
                <Button onClick={() => setShowConnectModal(true)} className="mt-5 btn-pill">
                  Connect wallet
                </Button>
              </div>
            )}
            {isConnected && (
              <>
                <h2 className="text-xl font-semibold text-white mb-2">Ask me anything about Sonark</h2>
                <p className="text-sm text-[#58586A] mb-8">I can help with strategy analysis, market conditions, and your portfolio.</p>
              </>
            )}
            {/* Suggestion chips */}
            <div className="flex flex-wrap gap-2 justify-center max-w-lg">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  disabled={!isConnected}
                  className="rounded-full border border-[rgba(169,168,236,0.2)] bg-[rgba(169,168,236,0.06)] px-4 py-2 text-xs text-[#9191A4] hover:border-[rgba(169,168,236,0.4)] hover:text-white hover:bg-[rgba(169,168,236,0.1)] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto space-y-5 px-4">
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChatMessage message={msg} />
                </motion.div>
              ))}
              {isStreaming && messages.at(-1)?.role === 'user' && (
                <motion.div
                  key="typing"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <TypingIndicator />
                </motion.div>
              )}
            </AnimatePresence>
            {error && (
              <div className="text-xs text-[#F47C72] bg-[rgba(239,68,68,0.08)] border border-[rgba(239,68,68,0.2)] rounded-lg px-4 py-3">
                Error: {error}. Make sure the API server is running.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Input + status bar */}
      <div className="border-t border-[rgba(255,255,255,0.06)] pt-4">
        <div className="max-w-2xl mx-auto">
          <ChatInput
            onSend={sendMessage}
            disabled={!isConnected || isStreaming}
            placeholder={isConnected ? 'Ask about your portfolio...' : 'Connect your wallet to start chatting...'}
          />
          <div className="flex items-center justify-between mt-2 px-1">
            <p className="text-[10px] uppercase tracking-wider text-[#58586A]">
              Uses your live Sonark data
            </p>
            <p className="text-[10px] uppercase tracking-wider text-[#58586A]">
              {isEmpty ? 'No conversation selected' : `${messages.length} messages`}
            </p>
          </div>
        </div>
      </div>

      <ConnectModal open={showConnectModal} onClose={() => setShowConnectModal(false)} />
    </div>
  )
}
