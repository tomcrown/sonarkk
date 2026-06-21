import { Routes, Route, Navigate } from 'react-router-dom'

// Minimal page rendered inside the Enoki OAuth popup after Google redirects back.
// Renders nothing visible — the Enoki wallet polls popup.location.hash for the
// #id_token fragment and closes the popup itself. Must not redirect away.
function AuthCallback() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#121213',
        color: '#58586A',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
      }}
    >
      Completing sign-in…
    </div>
  )
}
import { lazy, Suspense } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import Landing from '@/pages/Landing'
import Dashboard from '@/pages/Dashboard'
import Analytics from '@/pages/Analytics'
import Leaderboard from '@/pages/Leaderboard'
import CopyTrading from '@/pages/CopyTrading'
import Explore from '@/pages/Explore'
import Copilot from '@/pages/Copilot'
import Portfolios from '@/pages/Portfolios'
import PortfolioDetail from '@/pages/PortfolioDetail'
import Backtest from '@/pages/Backtest'

const DocsLayout = lazy(() => import('@/pages/docs/DocsLayout'))

export default function App() {
  return (
    <Routes>
      {/* Landing page — no shell */}
      <Route path="/" element={<Landing />} />

      {/* OAuth popup callback — must NOT redirect so the Enoki wallet can
          poll popup.location.hash for the #id_token fragment before closing */}
      <Route path="/auth/callback" element={<AuthCallback />} />

      {/* Docs — standalone layout, no AppShell */}
      <Route path="/docs" element={<Navigate to="/docs/introduction" replace />} />
      <Route
        path="/docs/:slug"
        element={
          <Suspense fallback={null}>
            <DocsLayout />
          </Suspense>
        }
      />

      {/* App shell wraps all authenticated pages */}
      <Route element={<AppShell />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
        <Route path="/copy-trading" element={<CopyTrading />} />
        <Route path="/explore" element={<Explore />} />
        <Route path="/copilot" element={<Copilot />} />
        <Route path="/portfolios" element={<Portfolios />} />
        <Route path="/portfolios/:id" element={<PortfolioDetail />} />
        <Route path="/backtest" element={<Backtest />} />
      </Route>

      {/* Catch-all */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
