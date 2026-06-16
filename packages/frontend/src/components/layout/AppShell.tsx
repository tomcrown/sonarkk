import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { Header } from './Header'

export function AppShell() {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-base)' }}>
      <Sidebar />
      <Header />
      <main className="ml-[220px] pt-14 min-h-screen">
        <div className="p-6 max-w-[1440px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
