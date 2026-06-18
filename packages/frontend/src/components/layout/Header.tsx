import { Link } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { WalletButton } from '@/components/wallet/WalletButton'

export function Header() {
  return (
    <header className="h-16 border-b border-border flex items-center justify-between px-8 sticky top-0 bg-background/80 backdrop-blur z-30 shrink-0">
      <div className="flex items-center gap-3 text-xs">
        <span className="flex items-center gap-2 text-success">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
          Bot engine online
        </span>
      </div>
      <WalletButton />
    </header>
  )
}

export function LandingHeader() {
  return (
    <header className="fixed top-0 inset-x-0 z-50 h-20 flex items-center justify-between px-8 md:px-16">
      <div className="flex items-center gap-8 text-sm">
        <a
          href="https://twitter.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Twitter
        </a>
        <a
          href="https://discord.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Discord
        </a>
      </div>

      <Link to="/" className="flex items-center gap-2" aria-label="Sonark home">
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent-light to-accent flex items-center justify-center">
          <Zap className="w-4 h-4 text-background" strokeWidth={2.5} />
        </div>
        <span className="font-display text-lg font-semibold">Sonark</span>
      </Link>

      <div className="flex items-center gap-6 text-sm">
        <a href="#docs" className="text-muted-foreground hover:text-foreground transition-colors hidden md:inline">
          Docs
        </a>
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-to-r from-accent-light to-accent text-background font-medium hover:opacity-90 transition-opacity"
        >
          Launch App
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </div>
    </header>
  )
}
