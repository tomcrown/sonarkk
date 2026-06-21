interface CodeBlockProps {
  children: string
  label?: string
}

export function CodeBlock({ children, label }: CodeBlockProps) {
  return (
    <div className="rounded-xl overflow-hidden border border-border/60 my-6" style={{ background: '#09090B' }}>
      {label && (
        <div
          className="flex items-center justify-between px-5 py-2.5 border-b border-border/50"
          style={{ background: '#0D0D10' }}
        >
          <span className="font-mono text-[10px] tracking-[0.18em] text-text-dim">{label}</span>
        </div>
      )}
      <pre className="p-5 overflow-x-auto">
        <code className="font-mono text-[13px] text-foreground/80 leading-relaxed whitespace-pre">
          {children}
        </code>
      </pre>
    </div>
  )
}
