import { useState, useCallback, useRef } from 'react'
import { streamChat, type ChatMessage } from '@/lib/api'

interface UseChatReturn {
  messages: ChatMessage[]
  isStreaming: boolean
  error: string | null
  sendMessage: (content: string, portfolioId?: string) => Promise<void>
  clearMessages: () => void
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(
    async (content: string, portfolioId?: string) => {
      if (isStreaming) return

      const userMessage: ChatMessage = { role: 'user', content }
      const nextHistory = [...messages, userMessage]

      setMessages(nextHistory)
      setIsStreaming(true)
      setError(null)

      // Placeholder for streaming assistant response
      const assistantMessage: ChatMessage = { role: 'assistant', content: '' }
      setMessages([...nextHistory, assistantMessage])

      abortRef.current = new AbortController()

      try {
        const gen = streamChat(content, portfolioId, messages, abortRef.current.signal)
        let accumulated = ''

        for await (const token of gen) {
          accumulated += token
          setMessages((prev) => {
            const updated = [...prev]
            const last = updated[updated.length - 1]
            if (last?.role === 'assistant') {
              updated[updated.length - 1] = { ...last, content: accumulated }
            }
            return updated
          })
        }
      } catch (err) {
        if ((err as Error).name === 'AbortError') return
        const msg = err instanceof Error ? err.message : 'Unknown error'
        setError(msg)
        setMessages((prev) => {
          const updated = [...prev]
          const last = updated[updated.length - 1]
          if (last?.role === 'assistant' && last.content === '') {
            updated.pop()
          }
          return updated
        })
      } finally {
        setIsStreaming(false)
        abortRef.current = null
      }
    },
    [messages, isStreaming],
  )

  const clearMessages = useCallback(() => {
    abortRef.current?.abort()
    setMessages([])
    setError(null)
    setIsStreaming(false)
  }, [])

  return { messages, isStreaming, error, sendMessage, clearMessages }
}
