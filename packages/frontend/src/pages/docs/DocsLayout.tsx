import { useState, lazy, Suspense } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { Menu, ArrowRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { DocsSidebar } from './DocsSidebar'
import { getSectionForSlug, getLabelForSlug } from './docsNav'

const PAGES: Record<string, React.LazyExoticComponent<() => JSX.Element>> = {
  'introduction':    lazy(() => import('./content/Introduction')),
  'quick-start':     lazy(() => import('./content/QuickStart')),
  'the-keeper':      lazy(() => import('./content/TheKeeper')),
  'vault-share-tokens': lazy(() => import('./content/VaultShareTokens')),
  'policy-cap':      lazy(() => import('./content/PolicyCap')),
  'house-strategies':  lazy(() => import('./content/HouseStrategies')),
  'bettor-strategies': lazy(() => import('./content/BettorStrategies')),
  'risk-parameters':   lazy(() => import('./content/RiskParameters')),
  'for-copiers':     lazy(() => import('./content/ForCopiers')),
  'for-creators':    lazy(() => import('./content/ForCreators')),
  'seal-encryption': lazy(() => import('./content/SealEncryption')),
  'deepbook-predict': lazy(() => import('./content/DeepBookPredict')),
  'deepbook-spot':   lazy(() => import('./content/DeepBookSpot')),
  'seal-walrus':     lazy(() => import('./content/SealWalrus')),
  'zklogin':         lazy(() => import('./content/ZkLogin')),
  'glossary':        lazy(() => import('./content/Glossary')),
}

export default function DocsLayout() {
  const { slug = 'introduction' } = useParams<{ slug: string }>()
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const PageComponent = PAGES[slug]
  if (!PageComponent) return <Navigate to="/docs/introduction" replace />

  const section = getSectionForSlug(slug)
  const label   = getLabelForSlug(slug)

  return (
    <div className="min-h-screen bg-background text-foreground noise-grain">
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-50 h-16 border-b border-border bg-background/80 backdrop-blur flex items-center justify-between px-4 md:px-8 shrink-0">
        {/* Left — hamburger (mobile) + logo */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-2 transition-colors md:hidden"
            aria-label="Open menu"
          >
            <Menu className="w-5 h-5" />
          </button>

          <Link to="/" className="flex items-center gap-2" aria-label="Sonark home">
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
                className="relative w-8 h-8 object-contain"
              />
            </motion.div>
            <span className="font-display font-semibold text-sm text-foreground">Sonark</span>
            <span
              className="hidden sm:inline text-[10px] tracking-[0.15em] font-semibold px-2 py-0.5 rounded-full"
              style={{
                color: '#A9A8EC',
                background: 'rgba(169,168,236,0.12)',
                border: '1px solid rgba(169,168,236,0.2)',
              }}
            >
              DOCS
            </span>
          </Link>
        </div>

        {/* Center — breadcrumb on desktop */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-text-dim absolute left-1/2 -translate-x-1/2">
          <span>{section}</span>
          <span className="opacity-40">/</span>
          <span className="text-muted-foreground">{label}</span>
        </div>

        {/* Right — Launch App */}
        <Link
          to="/dashboard"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r from-accent-light to-accent text-background text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Launch App <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </header>

      {/* ── Body ────────────────────────────────────────────────────────────── */}
      <div className="flex">
        <DocsSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        {/* Content */}
        <main className="flex-1 min-w-0 md:pl-0">
          <div className="max-w-[720px] mx-auto px-6 md:px-10 py-12">
            <Suspense
              fallback={
                <div className="flex items-center justify-center py-24">
                  <span className="text-sm text-text-dim animate-pulse">Loading…</span>
                </div>
              }
            >
              <PageComponent />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  )
}
