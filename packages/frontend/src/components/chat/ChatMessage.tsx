import { Zap } from 'lucide-react'
import { type ChatMessage as ChatMessageType } from '@/lib/api'
import { cn } from '@/lib/cn'

interface ChatMessageProps {
  message: ChatMessageType
}

export function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={cn('flex gap-3', isUser ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar */}
      {!isUser && (
        <div className="w-7 h-7 rounded-full bg-[#A9A8EC] flex items-center justify-center shrink-0 mt-0.5 shadow-[0_0_8px_rgba(169,168,236,0.4)]">
          <Zap className="w-3.5 h-3.5 text-white" aria-hidden />
        </div>
      )}

      {/* Bubble */}
      <div
        className={cn(
          'max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
          isUser
            ? 'bg-[#A9A8EC] text-white rounded-br-sm'
            : 'bg-[#1C1C21] text-[#FFFFFF] rounded-bl-sm border border-[rgba(255,255,255,0.06)]',
        )}
      >
        {message.content || <span className="text-[#58586A] italic">thinking...</span>}
      </div>
    </div>
  )
}
