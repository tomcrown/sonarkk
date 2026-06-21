import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'

interface DocPageProps {
  section: string
  title: string
  tagline: string
  children: React.ReactNode
}

export function DocPage({ section, title, tagline, children }: DocPageProps) {
  return (
    <article className="pb-24">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-xs text-text-dim mb-8 flex-wrap">
        <Link to="/docs/introduction" className="hover:text-muted-foreground transition-colors">
          Docs
        </Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <span className="text-text-dim">{section}</span>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <span className="text-muted-foreground">{title}</span>
      </nav>

      {/* Title + tagline */}
      <h1 className="text-3xl md:text-4xl font-display font-medium tracking-tight text-foreground">
        {title}
      </h1>
      <p className="mt-3 text-base text-muted-foreground leading-relaxed">
        {tagline}
      </p>

      {/* Divider */}
      <div className="mt-8 mb-10 border-b border-border" />

      {/* Content */}
      <div className="docs-prose">{children}</div>
    </article>
  )
}

/* ── Prose helpers exported for content pages ─────────────────────────── */

export function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-display font-semibold text-foreground mt-12 mb-4 scroll-mt-24">
      {children}
    </h2>
  )
}

export function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-base font-semibold text-foreground mt-7 mb-2.5 scroll-mt-24">
      {children}
    </h3>
  )
}

export function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[15px] text-muted-foreground leading-[1.75] mb-4">{children}</p>
  )
}

export function UL({ children }: { children: React.ReactNode }) {
  return (
    <ul className="list-disc list-outside ml-5 space-y-2 mb-6 text-[15px] text-muted-foreground leading-[1.75]">
      {children}
    </ul>
  )
}

export function OL({ children }: { children: React.ReactNode }) {
  return (
    <ol className="list-decimal list-outside ml-5 space-y-2 mb-6 text-[15px] text-muted-foreground leading-[1.75]">
      {children}
    </ol>
  )
}

export function LI({ children }: { children: React.ReactNode }) {
  return <li>{children}</li>
}

export function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-foreground">{children}</strong>
}

export function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto my-6">
      <table className="w-full text-[14px] border-collapse">
        {children}
      </table>
    </div>
  )
}

export function THead({ children }: { children: React.ReactNode }) {
  return <thead className="border-b border-border">{children}</thead>
}

export function TBody({ children }: { children: React.ReactNode }) {
  return <tbody className="divide-y divide-border/50">{children}</tbody>
}

export function TR({ children }: { children: React.ReactNode }) {
  return <tr>{children}</tr>
}

export function TH({ children }: { children: React.ReactNode }) {
  return (
    <th className="text-left py-2.5 pr-6 font-semibold text-foreground text-[13px] tracking-wide">
      {children}
    </th>
  )
}

export function TD({ children }: { children: React.ReactNode }) {
  return (
    <td className="py-3 pr-6 text-muted-foreground align-top">{children}</td>
  )
}
