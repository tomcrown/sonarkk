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
      <div className="px-10 py-12 max-w-[1600px]">
        <div className="text-xs tracking-[0.2em] text-text-dim mb-3">STUDIO</div>
        <h1 className="text-6xl md:text-7xl font-display font-medium tracking-tight uppercase mb-12">My Portfolios</h1>
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
    <div className="px-10 py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">STUDIO</div>
      <div className="flex items-start justify-between mb-12">
        <div>
          <h1 className="text-6xl md:text-7xl font-display font-medium tracking-tight uppercase">My Portfolios</h1>
          <p className="text-muted-foreground mt-3">
            Your deployed strategy vaults. Each portfolio runs autonomously via the keeper.
          </p>
        </div>
        <Button asChild className="btn-pill shrink-0 mt-2">
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
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-6 text-center text-sm text-danger">
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
