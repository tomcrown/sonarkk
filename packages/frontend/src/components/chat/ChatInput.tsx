import { useState, useRef, useEffect } from 'react'
import { ArrowUp } from 'lucide-react'
import { cn } from '@/lib/cn'

interface ChatInputProps {
  onSend: (message: string) => void
  disabled?: boolean
  placeholder?: string
}

export function ChatInput({ onSend, disabled, placeholder = 'Ask about your portfolio...' }: ChatInputProps) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [value])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="flex items-end gap-3 rounded-2xl border border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.03)] px-4 py-3 transition-all focus-within:border-[rgba(169,168,236,0.4)]">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        rows={1}
        className="flex-1 resize-none bg-transparent text-sm text-white placeholder:text-[#58586A] focus:outline-none leading-relaxed"
        aria-label="Chat message"
      />
      <button
        onClick={handleSubmit}
        disabled={!value.trim() || disabled}
        className={cn(
          'w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all',
          value.trim() && !disabled
            ? 'bg-[#A9A8EC] text-white shadow-[0_0_12px_rgba(169,168,236,0.4)] hover:bg-[#8F8DD9]'
            : 'bg-[rgba(255,255,255,0.08)] text-[#58586A] cursor-not-allowed',
        )}
        aria-label="Send message"
      >
        <ArrowUp className="w-4 h-4" />
      </button>
    </div>
  )
}
