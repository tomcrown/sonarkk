import { Link } from 'react-router-dom'
import { Zap } from 'lucide-react'
import { WalletButton } from '@/components/wallet/WalletButton'

export function Header() {
  return (
    <header
      className="fixed top-0 left-[220px] right-0 h-14 z-10 flex items-center justify-end px-6"
      style={{
        background: 'rgba(18,18,19,0.85)',
        backdropFilter: 'blur(12px)',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <WalletButton />
    </header>
  )
}

export function LandingHeader() {
  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-8 py-4"
      style={{ background: 'transparent' }}
    >
      <div className="flex items-center gap-6">
        <a
          href="https://twitter.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm transition-colors"
          style={{ color: 'var(--ink-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)' }}
        >
          Twitter
        </a>
        <a
          href="https://discord.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm transition-colors"
          style={{ color: 'var(--ink-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)' }}
        >
          Discord
        </a>
      </div>

      <Link
        to="/"
        className="flex items-center gap-2 absolute left-1/2 -translate-x-1/2"
        aria-label="Sonark home"
      >
        <div
          className="w-6 h-6 rounded flex items-center justify-center"
          style={{ background: 'var(--accent)', color: '#0C0C14' }}
        >
          <Zap className="w-3.5 h-3.5" />
        </div>
        <span className="text-sm font-semibold" style={{ color: 'var(--ink-primary)' }}>Sonark</span>
      </Link>

      <div className="flex items-center gap-6">
        <a
          href="#docs"
          className="text-sm transition-colors"
          style={{ color: 'var(--ink-muted)' }}
          onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--ink-primary)' }}
          onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--ink-muted)' }}
        >
          Docs
        </a>
        <Link to="/dashboard" className="btn-pill text-sm">
          Launch App
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden>
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </div>
    </header>
  )
}
