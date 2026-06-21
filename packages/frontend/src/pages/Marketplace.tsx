import { useState, useMemo } from 'react'
import { Trophy, Copy, Eye } from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useLeaderboard } from '@/hooks/useLeaderboard'
import { LeaderboardTable } from '@/components/leaderboard/LeaderboardTable'
import { LeaderboardCaveat } from '@/components/common/LeaderboardCaveat'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { Button } from '@/components/ui/button'
import { type LeaderboardEntry } from '@/lib/api'
import { BETTOR_STRATEGIES, HOUSE_STRATEGIES } from '@/lib/constants'
import { formatPct, formatDusdc, truncateAddress } from '@/lib/format'
import { CopyTradingModal } from './CopyTradingModal'

function displayReturn(pct: number | null): string {
  return pct != null ? formatPct(pct) : '—'
}

type Tag = { label: string; color: string; bg: string }

function getEntryTags(entry: LeaderboardEntry): Tag[] {
  const tags: Tag[] = []
  if (entry.cycleCount > 0)
    tags.push({ label: 'LIVE', color: '#3DD68C', bg: 'rgba(61,214,140,0.12)' })
  if (HOUSE_STRATEGIES.has(entry.strategyType))
    tags.push({ label: 'HOUSE', color: '#A9A8EC', bg: 'rgba(169,168,236,0.12)' })
  else
    tags.push({ label: 'BETTOR', color: '#E8A627', bg: 'rgba(232,166,39,0.12)' })
  if (entry.sealBlobId)
    tags.push({ label: 'PRIVATE', color: '#9191A4', bg: 'rgba(145,145,164,0.10)' })
  else
    tags.push({ label: 'PUBLIC', color: '#58586A', bg: 'rgba(88,88,106,0.10)' })
  return tags
}

function TagPill({ tag }: { tag: Tag }) {
  return (
    <span
      className="text-[9px] font-semibold tracking-[0.1em] px-1.5 py-0.5 rounded"
      style={{ color: tag.color, background: tag.bg }}
    >
      {tag.label}
    </span>
  )
}

function FeaturedCardLarge({ entry, onCopy }: { entry: LeaderboardEntry; onCopy: (e: LeaderboardEntry) => void }) {
  const tags = getEntryTags(entry)
  const positive = (entry.totalReturnPct ?? 0) >= 0

  return (
    <div className="relative bg-card rounded-xl p-6 flex flex-col gap-5 overflow-hidden"
      style={{ border: '1px solid rgba(169,168,236,0.2)', boxShadow: '0 0 0 1px rgba(169,168,236,0.06) inset' }}
    >
      {/* Subtle accent line across top */}
      <div className="absolute top-0 left-0 right-0 h-[1.5px]" style={{ background: 'linear-gradient(90deg, #A9A8EC 0%, #D4CDF9 50%, transparent 100%)' }} />

      <div>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[10px] font-mono font-bold text-accent">#1</span>
          {tags.map((t) => <TagPill key={t.label} tag={t} />)}
        </div>
        <div className="text-2xl font-display font-bold uppercase tracking-tight truncate">{entry.portfolioName}</div>
        <div className="text-xs font-mono text-text-dim mt-1">{truncateAddress(entry.walletAddress)}</div>
      </div>

      <div className="w-fit">
        <StrategyBadge strategyType={entry.strategyType} />
      </div>

      <div className="grid grid-cols-2 gap-x-8 gap-y-4 border-t border-border/40 pt-4">
        {[
          { l: 'TOTAL RETURN', v: displayReturn(entry.totalReturnPct), accent: true },
          { l: 'TVL',          v: formatDusdc(entry.tvlRaw, 0), accent: false },
          { l: 'CYCLES',       v: entry.cycleCount.toLocaleString(), accent: false },
          { l: 'COPIERS',      v: String(entry.copierCount), accent: false },
        ].map((s) => (
          <div key={s.l}>
            <div className="text-[9px] tracking-[0.12em] text-text-dim mb-1">{s.l}</div>
            <div className={`text-lg font-bold font-mono ${s.accent ? (positive ? 'text-success' : 'text-foreground') : 'text-foreground'}`}>
              {s.v}
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-1">
        <Button variant="outline" size="sm" className="flex-1" asChild>
          <Link to={`/portfolios/${entry.portfolioId}`}><Eye className="w-3 h-3" /> View</Link>
        </Button>
        <button
          onClick={() => onCopy(entry)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-gradient-to-r from-accent-light to-accent text-background font-semibold text-xs hover:opacity-90 transition-opacity"
        >
          <Copy className="w-3 h-3" /> Copy
        </button>
      </div>
    </div>
  )
}

function FeaturedCardSmall({ entry, onCopy }: { entry: LeaderboardEntry; onCopy: (e: LeaderboardEntry) => void }) {
  const tags = getEntryTags(entry)
  const positive = (entry.totalReturnPct ?? 0) >= 0

  return (
    <div className="bg-card border border-border rounded-xl p-4 hover:border-accent/20 transition-colors group flex flex-col gap-3 h-full">
      <div>
        <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
          <span className="text-[10px] font-mono text-text-dim font-semibold">#{entry.rank}</span>
          {tags.slice(0, 2).map((t) => <TagPill key={t.label} tag={t} />)}
        </div>
        <div className="text-base font-display font-bold uppercase tracking-tight truncate">{entry.portfolioName}</div>
        <div className="text-xs font-mono text-text-dim mt-0.5">{truncateAddress(entry.walletAddress)}</div>
      </div>

      <div className="w-fit">
        <StrategyBadge strategyType={entry.strategyType} />
      </div>

      <div className="flex items-end justify-between mt-auto">
        <div className={`text-lg font-bold font-mono ${positive ? 'text-success' : 'text-danger'}`}>
          {displayReturn(entry.totalReturnPct)}
        </div>
        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/portfolios/${entry.portfolioId}`}>View</Link>
          </Button>
          <Button variant="outline" size="sm" onClick={() => onCopy(entry)}>Copy</Button>
        </div>
      </div>
    </div>
  )
}

function groupByCreator(entries: LeaderboardEntry[]) {
  const map = new Map<string, { address: string; strategies: LeaderboardEntry[]; totalCopiers: number; topEntry: LeaderboardEntry }>()
  for (const e of entries) {
    const existing = map.get(e.walletAddress)
    if (existing) {
      existing.strategies.push(e)
      existing.totalCopiers += e.copierCount
      if ((e.totalReturnPct ?? -Infinity) > (existing.topEntry.totalReturnPct ?? -Infinity)) {
        existing.topEntry = e
      }
    } else {
      map.set(e.walletAddress, { address: e.walletAddress, strategies: [e], totalCopiers: e.copierCount, topEntry: e })
    }
  }
  return Array.from(map.values())
    .sort((a, b) => b.strategies.length - a.strategies.length || b.totalCopiers - a.totalCopiers)
    .slice(0, 4)
}

export default function Marketplace() {
  const { data, isLoading, error } = useLeaderboard(50)
  const [copyTarget, setCopyTarget] = useState<LeaderboardEntry | null>(null)

  const entries       = data?.entries ?? []
  const houseEntries  = entries.filter((e) => HOUSE_STRATEGIES.has(e.strategyType))
  const bettorEntries = entries.filter((e) => BETTOR_STRATEGIES.has(e.strategyType))
  const totalCopiers  = entries.reduce((s, e) => s + (e.copierCount ?? 0), 0)
  const totalCycles   = entries.reduce((s, e) => s + (e.cycleCount ?? 0), 0)
  const frontRunners  = entries.slice(0, 3)
  const topCreators   = useMemo(() => groupByCreator(entries), [entries])

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">DISCOVER</div>
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight uppercase mb-8">Marketplace</h1>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {[
          { l: 'STRATEGIES',   v: isLoading ? '—' : String(entries.length) },
          { l: 'TOTAL COPIES', v: isLoading ? '—' : totalCopiers.toLocaleString() },
          { l: 'TOTAL CYCLES', v: isLoading ? '—' : totalCycles.toLocaleString() },
        ].map((s) => (
          <div key={s.l} className="bg-card border border-border rounded-lg p-5">
            <div className="text-[10px] tracking-[0.15em] text-text-dim mb-2">{s.l}</div>
            <div className="text-2xl font-display font-semibold">{s.v}</div>
          </div>
        ))}
      </div>

      {data?.caveat && (
        <div className="mb-8">
          <LeaderboardCaveat caveat={data.caveat} />
        </div>
      )}

      {isLoading ? (
        <div className="grid lg:grid-cols-[3fr_2fr] gap-6 mb-10">
          <div className="space-y-4">
            <Skeleton className="h-72 rounded-xl" />
            <div className="grid grid-cols-2 gap-4">
              <Skeleton className="h-48 rounded-xl" />
              <Skeleton className="h-48 rounded-xl" />
            </div>
          </div>
          <div className="space-y-3">
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
        </div>
      ) : error ? (
        <div className="rounded-xl border border-danger/20 bg-danger/5 p-6 text-center text-sm text-danger mb-10">
          Failed to load marketplace. Make sure the API server is running.
        </div>
      ) : entries.length === 0 ? (
        <EmptyState icon={Trophy} title="Marketplace is empty" description="No strategies have been deployed and run yet." />
      ) : (
        <>
          {/* Two-column panel */}
          <div className="grid lg:grid-cols-[3fr_2fr] gap-6 mb-12">

            {/* Left — Front Runners */}
            <div>
              <div className="mb-5">
                <div className="text-[10px] tracking-[0.15em] text-accent mb-1">FRONT RUNNERS</div>
                <h2 className="text-xl font-display font-medium">Top strategies this season</h2>
                <p className="text-xs text-text-dim mt-1">A quick look at the strongest performers on the board right now.</p>
              </div>

              {frontRunners[0] && (
                <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mb-4">
                  <FeaturedCardLarge entry={frontRunners[0]} onCopy={setCopyTarget} />
                </motion.div>
              )}

              {frontRunners.slice(1).length > 0 && (
                <div className="grid sm:grid-cols-2 gap-4">
                  {frontRunners.slice(1).map((entry, i) => (
                    <motion.div
                      key={entry.portfolioId}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: (i + 1) * 0.07 }}
                    >
                      <FeaturedCardSmall entry={entry} onCopy={setCopyTarget} />
                    </motion.div>
                  ))}
                </div>
              )}
            </div>

            {/* Right — Creators to Watch */}
            <div>
              <div className="mb-5">
                <div className="text-[10px] tracking-[0.15em] text-text-dim mb-1">CREATOR SIGNAL</div>
                <h2 className="text-xl font-display font-medium">Creators to watch</h2>
                <p className="text-xs text-text-dim mt-1">A snapshot of creators with active strategies on the board.</p>
              </div>

              <div className="space-y-3">
                {topCreators.length === 0 ? (
                  <div className="text-xs text-text-dim text-center py-8">No creators on the board yet.</div>
                ) : topCreators.map((creator, i) => {
                  const isHouse = HOUSE_STRATEGIES.has(creator.strategies[0]?.strategyType ?? -1)
                  return (
                    <motion.div
                      key={creator.address}
                      initial={{ opacity: 0, x: 6 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.06 }}
                      className="bg-card border border-border rounded-xl p-4"
                    >
                      <div className="flex items-center justify-between mb-3">
                        <div className="text-xs font-mono text-foreground">{truncateAddress(creator.address)}</div>
                        {isHouse ? (
                          <span className="text-[9px] font-semibold tracking-[0.1em] px-1.5 py-0.5 rounded" style={{ color: '#3DD68C', background: 'rgba(61,214,140,0.1)' }}>TRUSTED</span>
                        ) : (
                          <span className="text-[9px] font-semibold tracking-[0.1em] px-1.5 py-0.5 rounded" style={{ color: '#E8A627', background: 'rgba(232,166,39,0.1)' }}>EMERGING</span>
                        )}
                      </div>

                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { l: 'STRATEGIES', v: String(creator.strategies.length) },
                          { l: 'COPIERS',    v: String(creator.totalCopiers) },
                          { l: 'CYCLES',     v: String(creator.strategies.reduce((s, e) => s + e.cycleCount, 0)) },
                        ].map((s) => (
                          <div key={s.l}>
                            <div className="text-[9px] tracking-[0.1em] text-text-dim mb-0.5">{s.l}</div>
                            <div className="text-sm font-semibold font-mono">{s.v}</div>
                          </div>
                        ))}
                      </div>

                      <div className="border-t border-border/50 pt-2.5">
                        <div className="text-[9px] tracking-[0.1em] text-text-dim mb-1">SPOTLIGHT BOT</div>
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase truncate">{creator.topEntry.portfolioName}</span>
                          <span className="text-[9px] font-mono text-text-dim">#{creator.topEntry.rank}</span>
                        </div>
                        <div className="text-[10px] text-text-dim mt-0.5">{creator.topEntry.cycleCount} live cycles</div>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Full Rankings */}
          <div className="bg-card border border-border rounded-xl overflow-hidden">
            <Tabs defaultValue="all">
              <div className="border-b border-border px-5 pt-5 pb-4 flex items-center justify-between flex-wrap gap-3">
                <div>
                  <div className="text-[10px] tracking-[0.15em] text-text-dim mb-0.5">FULL BOARD</div>
                  <h2 className="text-sm font-semibold uppercase tracking-wider">Full Rankings</h2>
                  <p className="text-xs text-text-dim mt-0.5">
                    Compare strategies across the board. Strategies: {entries.length} · Copies: {totalCopiers}
                  </p>
                </div>
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
          </div>
        </>
      )}

      <CopyTradingModal entry={copyTarget} open={!!copyTarget} onClose={() => setCopyTarget(null)} />
    </div>
  )
}
