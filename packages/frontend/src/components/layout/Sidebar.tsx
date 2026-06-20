import { NavLink, Link } from 'react-router-dom'
import {
  LayoutDashboard, BarChart3, Trophy, Copy, Compass,
  MessageSquare, FolderOpen, FlaskConical, X,
} from 'lucide-react'
import { motion } from 'framer-motion'
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

interface SidebarProps {
  open: boolean
  onClose: () => void
}

export function Sidebar({ open, onClose }: SidebarProps) {
  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 w-64 border-r border-border bg-sidebar flex flex-col overflow-y-auto transition-transform duration-200',
        'md:static md:translate-x-0 md:z-auto md:shrink-0',
        open ? 'translate-x-0' : '-translate-x-full',
      )}
      aria-label="Main navigation"
    >
      {/* Logo */}
      <Link
        to="/"
        onClick={onClose}
        className="h-16 flex items-center gap-1.5 px-6 border-b border-sidebar-border shrink-0"
        aria-label="Sonark home"
      >
        <motion.div className="relative shrink-0" whileHover="hovered">
          <motion.div
            className="absolute inset-0 rounded-full bg-accent/25 blur-md scale-150 pointer-events-none"
            variants={{ hovered: { opacity: 1 } }}
            initial={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
          />
          <motion.img
            src="/sonark-logo.png"
            alt="Sonark"
            animate={{ rotate: 360 }}
            transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
            className="relative w-11 h-11 object-contain"
          />
        </motion.div>
        <span className="font-display text-lg font-semibold tracking-tight text-foreground">Sonark</span>

        {/* Close button — mobile only */}
        <button
          onClick={onClose}
          className="ml-auto p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors md:hidden"
          aria-label="Close menu"
        >
          <X className="w-4 h-4" />
        </button>
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
                  onClick={onClose}
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
