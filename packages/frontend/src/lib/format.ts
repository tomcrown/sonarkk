import { DUSDC_DIVISOR, NAV_SCALE } from './constants'

/** Format raw DUSDC (6 decimals, arrives as string BigInt) to human-readable */
export function formatDusdc(raw: string | bigint | null | undefined, decimals = 2): string {
  if (raw == null || raw === '') return decimals > 0 ? `0.${'0'.repeat(decimals)} DUSDC` : '0 DUSDC'
  const value = typeof raw === 'string' ? BigInt(raw) : raw
  const whole = value / BigInt(DUSDC_DIVISOR)
  const frac = value % BigInt(DUSDC_DIVISOR)
  const fracStr = frac.toString().padStart(6, '0').slice(0, decimals)
  const wholeFormatted = Number(whole).toLocaleString('en-US')
  return decimals > 0 ? `${wholeFormatted}.${fracStr} DUSDC` : `${wholeFormatted} DUSDC`
}

/** Format raw DUSDC to a plain number (float) */
export function dusdcToNumber(raw: string | bigint): number {
  const value = typeof raw === 'string' ? BigInt(raw) : raw
  return Number(value) / DUSDC_DIVISOR
}

/** Format NAV per share (scaled by 1e9) */
export function formatNav(raw: string | bigint): string {
  const value = typeof raw === 'string' ? BigInt(raw) : raw
  const n = Number(value) / NAV_SCALE
  return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 })
}

/** Truncate a Sui address to 0x1234...5678 */
export function truncateAddress(address: string, prefixLen = 6, suffixLen = 4): string {
  if (!address) return ''
  if (address.length <= prefixLen + suffixLen + 2) return address
  return `${address.slice(0, prefixLen)}...${address.slice(-suffixLen)}`
}

/** Format a percentage */
export function formatPct(value: number, decimals = 2): string {
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(decimals)}%`
}

/** Format APY */
export function formatApy(value: number): string {
  if (!isFinite(value)) return 'N/A'
  if (Math.abs(value) >= 1000) {
    return `${value > 0 ? '+' : ''}${(value / 1000).toFixed(1)}K%`
  }
  return formatPct(value)
}

/** Format a number with commas */
export function formatNumber(value: number, decimals = 2): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/** Format unix timestamp ms to local date string */
export function formatDate(ms: number | string): string {
  const d = new Date(typeof ms === 'string' ? parseInt(ms) : ms)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Format unix timestamp ms to local datetime */
export function formatDateTime(ms: number | string): string {
  const d = new Date(typeof ms === 'string' ? parseInt(ms) : ms)
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Format a vol percentage (e.g. 0.27 → "27.0%") */
export function formatVol(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

/** Shorten a Walrus blob ID */
export function truncateBlobId(blobId: string): string {
  if (!blobId || blobId.length < 12) return blobId
  return `${blobId.slice(0, 8)}...${blobId.slice(-6)}`
}

/** Human-readable relative time: "4m ago", "2h ago", "3d ago" */
export function timeAgo(isoString: string | null | undefined): string {
  if (!isoString) return 'Never'
  const ms = Date.now() - new Date(isoString).getTime()
  const mins = Math.floor(ms / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
