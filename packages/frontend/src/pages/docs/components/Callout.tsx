import { AlertTriangle, Info } from 'lucide-react'

interface CalloutProps {
  type?: 'warning' | 'info'
  children: React.ReactNode
}

const CONFIG = {
  warning: {
    Icon: AlertTriangle,
    border: 'rgba(232,166,39,0.25)',
    bg: 'rgba(232,166,39,0.05)',
    iconColor: '#E8A627',
  },
  info: {
    Icon: Info,
    border: 'rgba(169,168,236,0.25)',
    bg: 'rgba(169,168,236,0.05)',
    iconColor: '#A9A8EC',
  },
}

export function Callout({ type = 'info', children }: CalloutProps) {
  const { Icon, border, bg, iconColor } = CONFIG[type]
  return (
    <div
      className="rounded-xl p-5 my-6 flex gap-3"
      style={{ border: `1px solid ${border}`, background: bg }}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" style={{ color: iconColor }} />
      <div className="text-[14px] text-muted-foreground leading-relaxed">{children}</div>
    </div>
  )
}
