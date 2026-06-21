import { NavLink } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { DOC_NAV } from './docsNav'

interface DocsSidebarProps {
  open: boolean
  onClose: () => void
}

export function DocsSidebar({ open, onClose }: DocsSidebarProps) {
  return (
    <>
      {/* Mobile overlay */}
      {open && (
        <div
          className="fixed inset-0 bg-background/80 backdrop-blur-sm z-30 md:hidden"
          onClick={onClose}
          aria-hidden
        />
      )}

      <aside
        className={cn(
          'fixed top-0 left-0 z-40 h-full w-64 border-r border-border flex flex-col overflow-y-auto transition-transform duration-200',
          'md:sticky md:top-16 md:h-[calc(100vh-4rem)] md:translate-x-0 md:z-auto md:shrink-0',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
        style={{ background: 'var(--color-sidebar, var(--bg-background))' }}
      >
        {/* Mobile header inside sidebar */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border md:hidden">
          <Link to="/" className="flex items-center gap-2">
            <motion.img
              src="/sonark-logo.png"
              alt="Sonark"
              animate={{ rotate: 360 }}
              transition={{ duration: 16, repeat: Infinity, ease: 'linear' }}
              className="w-7 h-7 object-contain"
            />
            <span className="font-display font-semibold text-sm">Sonark Docs</span>
          </Link>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-6 space-y-6">
          {DOC_NAV.map(({ section, items }) => (
            <div key={section}>
              <div className="px-3 mb-2 text-[10px] tracking-[0.18em] text-text-dim font-medium">
                {section}
              </div>
              <div className="space-y-0.5">
                {items.map(({ slug, label }) => (
                  <NavLink
                    key={slug}
                    to={`/docs/${slug}`}
                    onClick={onClose}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
                        isActive
                          ? 'bg-accent/15 text-accent-light'
                          : 'text-muted-foreground hover:text-foreground hover:bg-surface-2',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span>{label}</span>
                        {isActive && (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden />
                        )}
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Bottom — testnet indicator */}
        <div className="mx-3 mb-4 px-3 py-2 rounded-md flex items-center gap-2 shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
          <span className="text-xs text-text-dim">Sui testnet · live</span>
        </div>
      </aside>
    </>
  )
}
