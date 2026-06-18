import { Plus, Wallet } from 'lucide-react'
import { useCurrentWallet } from '@mysten/dapp-kit'
import { usePortfolios } from '@/hooks/usePortfolios'
import { PortfolioGrid } from '@/components/portfolio/PortfolioGrid'
import { EmptyState } from '@/components/common/EmptyState'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import { ConnectModal } from '@/components/wallet/ConnectModal'

export default function Portfolios() {
  const { isConnected, currentWallet } = useCurrentWallet()
  const walletAddress = currentWallet?.accounts[0]?.address
  const { data: portfolios, isLoading, error } = usePortfolios(walletAddress)
  const [showConnect, setShowConnect] = useState(false)

  if (!isConnected) {
    return (
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">Studio</p>
          <h1 className="text-2xl font-semibold text-white">My Portfolios</h1>
        </div>
        <EmptyState
          icon={Wallet}
          title="Connect your wallet"
          description="Connect a wallet to view and manage your deployed strategy portfolios."
          action={
            <Button onClick={() => setShowConnect(true)} className="btn-pill mt-4">
              Connect wallet
            </Button>
          }
        />
        <ConnectModal open={showConnect} onClose={() => setShowConnect(false)} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">Studio</p>
          <h1 className="text-2xl font-semibold text-white">My Portfolios</h1>
          <p className="text-sm text-[#9191A4] mt-1">
            Your deployed strategy vaults. Each portfolio runs autonomously via the keeper.
          </p>
        </div>
        <Button asChild className="btn-pill">
          <Link to="/explore">
            <Plus className="w-4 h-4" /> Deploy New
          </Link>
        </Button>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-5">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-48 rounded-xl" />)}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.06)] p-6 text-center text-sm text-[#F47C72]">
          Failed to load portfolios. Make sure the API server is running.
        </div>
      ) : !portfolios || portfolios.length === 0 ? (
        <EmptyState
          icon={Plus}
          title="No portfolios yet"
          description="You haven't deployed any strategies. Head to the Explore page to choose a strategy and deploy a vault."
          action={
            <Button asChild className="btn-pill mt-4">
              <Link to="/explore">Browse Strategies</Link>
            </Button>
          }
        />
      ) : (
        <PortfolioGrid portfolios={portfolios} />
      )}
    </div>
  )
}
