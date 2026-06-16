import { useState } from 'react'
import { Trophy } from 'lucide-react'
import { motion } from 'framer-motion'
import { useLeaderboard } from '@/hooks/useLeaderboard'
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable'
import { LeaderboardCaveat } from '@/components/common/LeaderboardCaveat'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { type LeaderboardEntry } from '@/lib/api'
import { BETTOR_STRATEGIES, HOUSE_STRATEGIES } from '@/lib/constants'
import { CopyTradingModal } from './CopyTradingModal'

export default function Leaderboard() {
  const { data, isLoading, error } = useLeaderboard(50)
  const [copyTarget, setCopyTarget] = useState<LeaderboardEntry | null>(null)

  const entries = data?.entries ?? []
  const houseEntries = entries.filter((e) => HOUSE_STRATEGIES.has(e.strategyType))
  const bettorEntries = entries.filter((e) => BETTOR_STRATEGIES.has(e.strategyType))

  return (
    <div className="space-y-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#58586A] mb-1">Discover</p>
        <h1 className="text-2xl font-semibold text-white">Leaderboard</h1>
        <p className="text-sm text-[#9191A4] mt-1">
          Strategies ranked by real on-chain performance. Every number is a verifiable Sui transaction.
        </p>
      </div>

      {data?.caveat && <LeaderboardCaveat caveat={data.caveat} />}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.06)] p-6 text-center text-sm text-[#F47C72]">
          Failed to load leaderboard. Make sure the API server is running.
        </div>
      ) : entries.length === 0 ? (
        <EmptyState
          icon={Trophy}
          title="Leaderboard is empty"
          description="No strategies have been deployed and run yet. Deploy a strategy to appear here."
        />
      ) : (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="bg-[#1C1C21] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden"
        >
          <Tabs defaultValue="all">
            <div className="border-b border-[rgba(255,255,255,0.06)] px-5 pt-5 pb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Full Board</h2>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="house">House</TabsTrigger>
                <TabsTrigger value="bettor">Bettor</TabsTrigger>
              </TabsList>
            </div>

            <div className="p-5">
              <TabsContent value="all">
                <LeaderboardTable entries={entries} onCopy={setCopyTarget} />
              </TabsContent>
              <TabsContent value="house">
                {houseEntries.length === 0 ? (
                  <p className="text-sm text-[#58586A] py-4">No house strategies on the board yet.</p>
                ) : (
                  <LeaderboardTable entries={houseEntries} onCopy={setCopyTarget} />
                )}
              </TabsContent>
              <TabsContent value="bettor">
                {bettorEntries.length === 0 ? (
                  <p className="text-sm text-[#58586A] py-4">No bettor strategies on the board yet.</p>
                ) : (
                  <LeaderboardTable entries={bettorEntries} onCopy={setCopyTarget} />
                )}
              </TabsContent>
            </div>
          </Tabs>
        </motion.div>
      )}

      <CopyTradingModal
        entry={copyTarget}
        open={!!copyTarget}
        onClose={() => setCopyTarget(null)}
      />
    </div>
  )
}
