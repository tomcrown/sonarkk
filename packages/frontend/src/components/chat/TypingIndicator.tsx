export function TypingIndicator() {
  return (
    <div className="flex items-center gap-1 px-4 py-3 bg-[#1C1C21] rounded-2xl rounded-bl-sm w-fit" aria-label="Copilot is typing">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full bg-[#A9A8EC] animate-[typing_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.2}s` }}
          aria-hidden
        />
      ))}
    </div>
  )
}
