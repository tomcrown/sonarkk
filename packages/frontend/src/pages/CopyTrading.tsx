import { useState } from 'react'
import { Copy, Lock, Users, Eye, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useLeaderboard } from '@/hooks/useLeaderboard'
import { LeaderboardCaveat } from '@/components/common/LeaderboardCaveat'
import { StrategyBadge } from '@/components/common/StrategyBadge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { WalrusBadge } from '@/components/common/WalrusBadge'
import { type LeaderboardEntry } from '@/lib/api'
import { HOUSE_STRATEGIES } from '@/lib/constants'
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

function FeaturedCardLarge({ entry, onMirror }: { entry: LeaderboardEntry; onMirror: (e: LeaderboardEntry) => void }) {
  const tags = getEntryTags(entry)
  const positive = (entry.totalReturnPct ?? 0) >= 0

  return (
    <div className="relative bg-card rounded-xl p-6 flex flex-col gap-5 overflow-hidden h-full"
      style={{ border: '1px solid rgba(169,168,236,0.2)', boxShadow: '0 0 0 1px rgba(169,168,236,0.06) inset' }}
    >
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

      <div className="flex gap-2 mt-auto pt-1">
        <Button variant="outline" size="sm" className="flex-1" asChild>
          <Link to={`/portfolios/${entry.portfolioId}`}><Eye className="w-3 h-3" /> View</Link>
        </Button>
        <button
          onClick={() => onMirror(entry)}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-md bg-gradient-to-r from-accent-light to-accent text-background font-semibold text-xs hover:opacity-90 transition-opacity"
        >
          <Copy className="w-3 h-3" /> Mirror
        </button>
      </div>
    </div>
  )
}

function FeaturedCardSmall({ entry, onMirror }: { entry: LeaderboardEntry; onMirror: (e: LeaderboardEntry) => void }) {
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
        <div className={`text-lg font-bold font-mono ${positive ? 'text-success' : 'text-foreground'}`}>
          {displayReturn(entry.totalReturnPct)}
        </div>
        <div className="flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/portfolios/${entry.portfolioId}`}>View</Link>
          </Button>
          <button
            onClick={() => onMirror(entry)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-gradient-to-r from-accent-light to-accent text-background font-semibold text-xs hover:opacity-90 transition-opacity"
          >
            <Copy className="w-3 h-3" /> Mirror
          </button>
        </div>
      </div>
    </div>
  )
}

export default function CopyTrading() {
  const { data, isLoading } = useLeaderboard(20)
  const [selected, setSelected] = useState<LeaderboardEntry | null>(null)

  const frontRunners = data?.entries.slice(0, 3) ?? []
  const allEntries   = data?.entries ?? []

  return (
    <div className="px-4 sm:px-6 lg:px-10 py-6 lg:py-12 max-w-[1600px]">
      <div className="text-xs tracking-[0.2em] text-text-dim mb-3">MIRROR</div>
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight uppercase mb-8">Copy Trading</h1>

      {data?.caveat && (
        <div className="mb-8">
          <LeaderboardCaveat caveat={data.caveat} />
        </div>
      )}

      {/* Front Runners */}
      <div className="mb-10">
        <div className="flex items-center justify-between mb-5">
          <div>
            <div className="text-[10px] tracking-[0.15em] text-accent mb-1">FRONT RUNNERS</div>
            <h2 className="text-xl font-display font-medium">Top strategies this season</h2>
            <p className="text-xs text-text-dim mt-1">A quick look at the strongest performers on the board right now.</p>
          </div>
          <Link to="/marketplace" className="inline-flex items-center gap-1.5 text-xs text-accent-light hover:text-accent transition-colors">
            View top profile <ArrowRight className="w-3 h-3" />
          </Link>
        </div>

        {isLoading ? (
          <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
            <Skeleton className="h-72 rounded-xl" />
            <div className="grid grid-rows-2 gap-4">
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-[1fr_1fr] gap-4">
            {/* #1 big card */}
            {frontRunners[0] && (
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <FeaturedCardLarge entry={frontRunners[0]} onMirror={setSelected} />
              </motion.div>
            )}

            {/* #2 and #3 stacked */}
            {frontRunners.slice(1).length > 0 && (
              <div className="flex flex-col gap-4">
                {frontRunners.slice(1).map((entry, i) => (
                  <motion.div
                    key={entry.portfolioId}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: (i + 1) * 0.07 }}
                    className="flex-1"
                  >
                    <FeaturedCardSmall entry={entry} onMirror={setSelected} />
                  </motion.div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Walrus proof banner */}
      {data?.latestWalrusSnapshot && (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 rounded-lg border border-teal-500/20 bg-teal-500/5">
          <WalrusBadge
            blobId={data.latestWalrusSnapshot.blobId}
            date={data.latestWalrusSnapshot.date}
            suiEventDigest={data.latestWalrusSnapshot.suiEventDigest}
          />
          <span className="text-[11px] text-text-dim">Leaderboard data anchored on Walrus — independently verifiable</span>
        </div>
      )}

      {/* Full Board */}
      <div>
        <div className="mb-4">
          <div className="text-[10px] tracking-[0.15em] text-text-dim mb-1">FULL BOARD</div>
          <h2 className="text-xl font-display font-medium">All strategies available to mirror</h2>
          <p className="text-xs text-text-dim mt-1">Compare trust, activity, and performance across the full board.</p>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          {isLoading ? (
            <div className="p-5 space-y-3">
              {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : allEntries.length === 0 ? (
            <div className="p-8 text-center text-sm text-text-dim">No strategies available to copy yet.</div>
          ) : (
            <div className="divide-y divide-border/50">
              {allEntries.map((entry, i) => {
                const tags = getEntryTags(entry)
                const positive = (entry.totalReturnPct ?? 0) >= 0
                return (
                  <motion.div
                    key={entry.portfolioId}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.02 }}
                    className="flex items-center gap-4 px-5 py-4 hover:bg-surface-2/40 transition-colors group"
                  >
                    {/* Rank */}
                    <span className={`text-sm font-bold font-mono w-8 shrink-0 ${i < 3 ? 'text-accent' : 'text-text-dim'}`}>
                      #{entry.rank}
                    </span>

                    {/* Strategy info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold uppercase tracking-tight truncate mb-1">{entry.portfolioName}</div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {tags.map((t) => <TagPill key={t.label} tag={t} />)}
                      </div>
                      <div className="text-[10px] font-mono text-text-dim mt-1">{truncateAddress(entry.walletAddress)}</div>
                    </div>

                    {/* Stat columns */}
                    <div className="hidden md:flex items-center gap-6 shrink-0">
                      <div className="text-right w-20">
                        <p className="text-[9px] uppercase tracking-[0.1em] text-text-dim mb-0.5">RETURN</p>
                        <p className={`text-sm font-semibold font-mono ${positive ? 'text-success' : 'text-foreground'}`}>
                          {displayReturn(entry.totalReturnPct)}
                        </p>
                      </div>
                      <div className="text-right w-16">
                        <p className="text-[9px] uppercase tracking-[0.1em] text-text-dim mb-0.5">CYCLES</p>
                        <p className="text-sm font-mono text-foreground">{entry.cycleCount}</p>
                      </div>
                      <div className="text-right w-16">
                        <p className="text-[9px] uppercase tracking-[0.1em] text-text-dim mb-0.5">COPIERS</p>
                        <p className="text-sm font-mono text-foreground flex items-center justify-end gap-1">
                          <Users className="w-3 h-3 text-text-dim" /> {entry.copierCount}
                        </p>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 shrink-0">
                      <Button size="sm" variant="ghost" className="opacity-0 group-hover:opacity-100 transition-opacity" asChild>
                        <Link to={`/portfolios/${entry.portfolioId}`}><Eye className="w-3 h-3" /> View</Link>
                      </Button>
                      <button
                        onClick={() => setSelected(entry)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-accent/30 text-accent font-semibold text-xs hover:bg-accent/10 transition-colors"
                      >
                        {entry.sealBlobId ? <Lock className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        Mirror
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <CopyTradingModal entry={selected} open={!!selected} onClose={() => setSelected(null)} />
    </div>
  )
}
