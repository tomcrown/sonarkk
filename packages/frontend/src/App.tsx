import { Routes, Route, Navigate } from 'react-router-dom'
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

export default function App() {
  return (
    <Routes>
      {/* Landing page — no shell */}
      <Route path="/" element={<Landing />} />

      {/* Auth callback for zkLogin — redirect back to dashboard */}
      <Route path="/auth/callback" element={<Navigate to="/dashboard" replace />} />

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
