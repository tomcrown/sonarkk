import type { Config } from 'tailwindcss'

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: {
          base:     '#121213',
          surface:  '#17171A',
          card:     '#1C1C21',
          hover:    '#202026',
          elevated: '#242429',
          inset:    '#0E0E0F',
        },
        accent: {
          DEFAULT: '#A9A8EC',
          light:   '#D4CDF9',
          dim:     'rgba(169,168,236,0.10)',
          border:  'rgba(169,168,236,0.18)',
          muted:   'rgba(169,168,236,0.06)',
        },
        line: {
          DEFAULT: 'rgba(255,255,255,0.06)',
          subtle:  'rgba(255,255,255,0.04)',
          strong:  'rgba(255,255,255,0.10)',
        },
        ink: {
          primary:   '#FFFFFF',
          secondary: '#9191A4',
          muted:     '#58586A',
          accent:    '#A9A8EC',
          faint:     '#3A3A48',
        },
        status: {
          green:  '#3DD68C',
          yellow: '#E8A627',
          red:    '#F04438',
          blue:   '#60A5FA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'card':     '0 1px 2px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.055)',
        'card-md':  '0 4px 16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.07)',
        'card-lg':  '0 8px 40px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.08)',
        'accent':   '0 0 0 1px rgba(169,168,236,0.35)',
        'accent-glow': '0 0 20px rgba(169,168,236,0.15)',
        'popover':  '0 20px 60px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.08)',
      },
      backgroundImage: {
        'page-atmosphere': 'radial-gradient(ellipse 100% 35% at 50% -5%, rgba(169,168,236,0.07) 0%, transparent 70%)',
        'card-sheen':      'linear-gradient(135deg, rgba(255,255,255,0.03) 0%, rgba(255,255,255,0) 60%)',
        'accent-gradient': 'linear-gradient(135deg, #A9A8EC 0%, #D4CDF9 100%)',
      },
      keyframes: {
        'fade-in':  { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        'pulse-subtle': {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.4' },
        },
        typing: {
          '0%, 60%, 100%': { transform: 'translateY(0)' },
          '30%': { transform: 'translateY(-4px)' },
        },
      },
      animation: {
        'fade-in':      'fade-in 0.2s ease-out',
        'slide-up':     'slide-up 0.22s ease-out',
        'pulse-subtle': 'pulse-subtle 2s ease-in-out infinite',
        'typing':       'typing 1.2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}

export default config
