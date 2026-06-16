import { useState } from 'react'
import { Compass } from 'lucide-react'
import { StrategyCard } from '@/components/strategy/StrategyCard'
import { DeployModal } from '@/components/strategy/DeployModal'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'

const HOUSE_TYPES = [0, 1, 2, 3]
const BETTOR_TYPES = [4, 5, 6]

export default function Explore() {
  const [deployTarget, setDeployTarget] = useState<number | null>(null)

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">Studio</p>
        <h1 className="text-2xl font-semibold text-white">Strategy Explorer</h1>
        <p className="text-sm text-[#9191A4] mt-1">
          Browse all available strategies. House strategies have structural edge; bettor strategies are short-vol views.
        </p>
      </div>

      <Tabs defaultValue="house">
        <TabsList>
          <TabsTrigger value="house">House (structural edge)</TabsTrigger>
          <TabsTrigger value="bettor">Bettor (short vol)</TabsTrigger>
        </TabsList>

        <TabsContent value="house">
          <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-5 mt-2">
            {HOUSE_TYPES.map((t, i) => (
              <StrategyCard key={t} strategyType={t} onDeploy={setDeployTarget} index={i} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="bettor">
          <div className="rounded-lg border border-[rgba(245,158,11,0.25)] bg-[rgba(245,158,11,0.06)] px-4 py-3 mb-5 text-sm text-[#fbbf24]">
            All bettor strategies are short-volatility views. They profit in calm markets and lose when BTC moves violently.
            Understand the regime conditions before deploying.
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {BETTOR_TYPES.map((t, i) => (
              <StrategyCard key={t} strategyType={t} onDeploy={setDeployTarget} index={i} />
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <DeployModal
        strategyType={deployTarget}
        open={deployTarget !== null}
        onClose={() => setDeployTarget(null)}
      />
    </div>
  )
}
