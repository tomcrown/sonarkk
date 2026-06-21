import { ShieldCheck, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/cn'

interface WalrusBadgeProps {
  blobId: string
  date?: string
  suiEventDigest?: string | null
  className?: string
}

export function WalrusBadge({ blobId, date, suiEventDigest, className }: WalrusBadgeProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <a
        href={`https://walruscan.com/testnet/blob/${blobId}`}
        target="_blank"
        rel="noopener noreferrer"
        onClick={e => e.stopPropagation()}
        className="inline-flex items-center gap-1.5 text-[11px] font-mono text-teal-400 hover:text-teal-300 transition-colors"
      >
        <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
        <span>Walrus verified{date ? ` · ${date}` : ''}</span>
        <ExternalLink className="w-2.5 h-2.5 opacity-60" />
      </a>
      {suiEventDigest && (
        <a
          href={`https://testnet.suivision.xyz/txblock/${suiEventDigest}`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-[11px] font-mono text-text-dim hover:text-foreground transition-colors"
        >
          <span>On-chain TX</span>
          <ExternalLink className="w-2.5 h-2.5 opacity-60" />
        </a>
      )}
    </div>
  )
}
