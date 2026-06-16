import { Info } from 'lucide-react'

interface LeaderboardCaveatProps {
  caveat: string
}

export function LeaderboardCaveat({ caveat }: LeaderboardCaveatProps) {
  return (
    <div
      role="note"
      aria-label="Performance data disclaimer"
      className="flex gap-2.5 items-start rounded-lg border border-[rgba(169,168,236,0.2)] bg-[rgba(169,168,236,0.06)] px-4 py-3"
    >
      <Info className="w-4 h-4 text-[#A9A8EC] shrink-0 mt-0.5" aria-hidden />
      <p className="text-xs text-[#9191A4] leading-relaxed">{caveat}</p>
    </div>
  )
}
