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

  const entries       = data?.entries ?? []
  const houseEntries  = entries.filter((e) => HOUSE_STRATEGIES.has(e.strategyType))
  const bettorEntries = entries.filter((e) => BETTOR_STRATEGIES.has(e.strategyType))

  const totalCopiers   = entries.reduce((s, e) => s + (e.copierCount ?? 0), 0)
  const totalCycles    = entries.reduce((s, e) => s + (e.cycleCount ?? 0), 0)

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">DISCOVER</div>
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight uppercase mb-10">Leaderboard</h1>

      {/* Summary stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-12">
        {[
          { l: 'STRATEGIES',  v: isLoading ? '—' : String(entries.length) },
          { l: 'TOTAL COPIES', v: isLoading ? '—' : totalCopiers.toLocaleString() },
          { l: 'TOTAL CYCLES', v: isLoading ? '—' : totalCycles.toLocaleString() },
        ].map((s) => (
          <div key={s.l} className="bg-card border border-border rounded-lg p-6">
            <div className="text-[10px] tracking-[0.15em] text-text-dim mb-3">{s.l}</div>
            <div className="text-2xl md:text-3xl font-display font-medium">{s.v}</div>
          </div>
        ))}
      </div>

      {data?.caveat && <LeaderboardCaveat caveat={data.caveat} />}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-6 text-center text-sm text-danger">
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
          className="bg-card border border-border rounded-xl overflow-hidden"
        >
          <Tabs defaultValue="all">
            <div className="border-b border-border px-5 pt-5 pb-4 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Full Board</h2>
              <TabsList>
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="house">House</TabsTrigger>
                <TabsTrigger value="bettor">Bettor</TabsTrigger>
              </TabsList>
            </div>
            <div className="p-5">
              <TabsContent value="all">
                <div className="overflow-x-auto">
                  <LeaderboardTable entries={entries} onCopy={setCopyTarget} />
                </div>
              </TabsContent>
              <TabsContent value="house">
                {houseEntries.length === 0 ? (
                  <p className="text-sm text-text-dim py-4">No house strategies on the board yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <LeaderboardTable entries={houseEntries} onCopy={setCopyTarget} />
                  </div>
                )}
              </TabsContent>
              <TabsContent value="bettor">
                {bettorEntries.length === 0 ? (
                  <p className="text-sm text-text-dim py-4">No bettor strategies on the board yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <LeaderboardTable entries={bettorEntries} onCopy={setCopyTarget} />
                  </div>
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
