import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, BarChart3, Trophy, Copy, Compass,
  MessageSquare, FolderOpen, FlaskConical, Zap,
} from 'lucide-react'
import { cn } from '@/lib/cn'

const NAV = [
  {
    section: 'OVERVIEW',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/analytics',  icon: BarChart3,       label: 'Market Intel' },
    ],
  },
  {
    section: 'TRADE',
    items: [
      { to: '/explore',  icon: Compass,      label: 'Strategy Studio' },
      { to: '/backtest', icon: FlaskConical, label: 'Simulation Room' },
    ],
  },
  {
    section: 'DISCOVER',
    items: [
      { to: '/leaderboard',  icon: Trophy,          label: 'Leaderboard'   },
      { to: '/copy-trading', icon: Copy,            label: 'Copy Trading'  },
      { to: '/portfolios',   icon: FolderOpen,      label: 'My Portfolios' },
    ],
  },
  {
    section: 'AI',
    items: [
      { to: '/copilot', icon: MessageSquare, label: 'Copilot' },
    ],
  },
]

export function Sidebar() {
  return (
    <aside
      className="w-64 shrink-0 border-r border-border bg-sidebar flex flex-col overflow-y-auto"
      aria-label="Main navigation"
    >
      {/* Logo */}
      <Link
        to="/"
        className="h-16 flex items-center gap-2 px-6 border-b border-sidebar-border shrink-0"
        aria-label="Sonark home"
      >
        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-accent-light to-accent flex items-center justify-center">
          <Zap className="w-4 h-4 text-background" strokeWidth={2.5} />
        </div>
        <span className="font-display text-lg font-semibold tracking-tight text-foreground">Sonark</span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 px-3 py-6 space-y-6">
        {NAV.map((section) => (
          <div key={section.section}>
            <div className="px-3 mb-2 text-[10px] tracking-[0.18em] text-text-dim font-medium">
              {section.section}
            </div>
            <div className="space-y-0.5">
              {section.items.map(({ to, icon: Icon, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end
                  className={({ isActive }) =>
                    cn(
                      'flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors',
                      isActive
                        ? 'bg-accent/15 text-accent-light'
                        : 'text-muted-foreground hover:text-foreground hover:bg-surface-2',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <Icon className="w-4 h-4 shrink-0" />
                      <span>{label}</span>
                      {isActive && (
                        <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" aria-hidden />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom status */}
      <div className="mx-3 mb-3 px-3 py-2 rounded-md flex items-center gap-2 shrink-0">
        <span className="dot-live" />
        <span className="text-xs text-text-dim">Testnet live</span>
      </div>
    </aside>
  )
}
