import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { type ChatMessage as ChatMessageType } from '@/lib/api'
import { cn } from '@/lib/cn'

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

      {/* Message body — no bubble, just the content */}
      <div className="flex-1 min-w-0 pt-0.5">
        {message.content && (
          <div className="prose-chat">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  )
}
