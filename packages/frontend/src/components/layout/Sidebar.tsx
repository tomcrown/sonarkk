import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, BarChart3, Trophy, Copy, Compass,
  MessageSquare, FolderOpen, FlaskConical, Zap,
} from 'lucide-react'
import { cn } from '@/lib/cn'

const NAV = [
  {
    label: 'Overview',
    items: [
      { to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { to: '/analytics',  icon: BarChart3,       label: 'Analytics'  },
    ],
  },
  {
    label: 'Discover',
    items: [
      { to: '/leaderboard',  icon: Trophy, label: 'Leaderboard'  },
      { to: '/copy-trading', icon: Copy,   label: 'Copy Trading' },
    ],
  },
  {
    label: 'Studio',
    items: [
      { to: '/explore',    icon: Compass,       label: 'Explore'       },
      { to: '/copilot',    icon: MessageSquare, label: 'Copilot'       },
      { to: '/portfolios', icon: FolderOpen,    label: 'My Portfolios' },
      { to: '/backtest',   icon: FlaskConical,  label: 'Backtest'      },
    ],
  },
]

export function Sidebar() {
  return (
    <aside
      className="fixed left-0 top-0 bottom-0 w-[220px] flex flex-col z-20"
      style={{ background: 'var(--bg-surface)', borderRight: '1px solid var(--line)' }}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <div
        className="flex items-center gap-2.5 px-5 h-14 shrink-0"
        style={{ borderBottom: '1px solid var(--line)' }}
      >
        <Link to="/" className="flex items-center gap-2.5" aria-label="Sonark home">
          <div
            className="w-6 h-6 rounded flex items-center justify-center"
            style={{ background: 'var(--accent)', color: '#0C0C14' }}
          >
            <Zap className="w-3.5 h-3.5" />
          </div>
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--ink-primary)' }}
          >
            Sonark
          </span>
        </Link>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-3 px-2.5">
        {NAV.map((section) => (
          <div key={section.label} className="mb-4">
            <p className="section-label px-2.5 mb-1.5">{section.label}</p>
            <ul role="list" className="space-y-px">
              {section.items.map(({ to, icon: Icon, label }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end
                    className={({ isActive }) =>
                      cn(
                        'relative flex items-center gap-2.5 px-2.5 py-[7px] rounded text-[13px] transition-all duration-100 group',
                        isActive
                          ? 'text-[var(--accent)]'
                          : 'text-[var(--ink-muted)] hover:text-[var(--ink-secondary)] hover:bg-[rgba(255,255,255,0.035)]',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && (
                          <span
                            className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-[14px] rounded-r"
                            style={{ background: 'var(--accent)' }}
                            aria-hidden
                          />
                        )}
                        <Icon
                          className={cn(
                            'w-[15px] h-[15px] shrink-0 transition-colors',
                            isActive ? 'text-[var(--accent)]' : 'text-[var(--ink-muted)] group-hover:text-[var(--ink-secondary)]',
                          )}
                        />
                        <span className={isActive ? 'font-medium' : ''}>{label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Bottom status */}
      <div
        className="px-4 py-3 shrink-0 flex items-center gap-2"
        style={{ borderTop: '1px solid var(--line)' }}
      >
        <span className="dot-live" />
        <span className="text-xs" style={{ color: 'var(--ink-muted)' }}>Testnet live</span>
      </div>
    </aside>
  )
}
