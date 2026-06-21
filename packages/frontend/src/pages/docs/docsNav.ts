export interface DocItem {
  slug: string
  label: string
}

export interface DocSection {
  section: string
  items: DocItem[]
}

export const DOC_NAV: DocSection[] = [
  {
    section: 'GET STARTED',
    items: [
      { slug: 'introduction',  label: 'Introduction' },
      { slug: 'quick-start',   label: 'Quick Start' },
    ],
  },
  {
    section: 'CORE CONCEPTS',
    items: [
      { slug: 'the-keeper',          label: 'The Keeper' },
      { slug: 'vault-share-tokens',  label: 'Vault & Share Tokens' },
      { slug: 'policy-cap',          label: 'PolicyCap & Authorization' },
    ],
  },
  {
    section: 'STRATEGIES',
    items: [
      { slug: 'house-strategies',  label: 'House Strategies' },
      { slug: 'bettor-strategies', label: 'Bettor Strategies' },
      { slug: 'risk-parameters',   label: 'Risk Parameters' },
    ],
  },
  {
    section: 'COPY TRADING',
    items: [
      { slug: 'for-copiers',      label: 'For Copiers' },
      { slug: 'for-creators',     label: 'For Creators' },
      { slug: 'seal-encryption',  label: 'Seal Encryption' },
    ],
  },
  {
    section: 'INFRASTRUCTURE',
    items: [
      { slug: 'deepbook-predict', label: 'DeepBook Predict' },
      { slug: 'deepbook-spot',    label: 'DeepBook Spot' },
      { slug: 'seal-walrus',      label: 'Seal & Walrus' },
      { slug: 'zklogin',          label: 'zkLogin' },
    ],
  },
  {
    section: 'REFERENCE',
    items: [
      { slug: 'glossary', label: 'Glossary' },
    ],
  },
]

export function getSectionForSlug(slug: string): string {
  for (const s of DOC_NAV) {
    if (s.items.some(i => i.slug === slug)) return s.section
  }
  return 'Docs'
}

export function getLabelForSlug(slug: string): string {
  for (const s of DOC_NAV) {
    const item = s.items.find(i => i.slug === slug)
    if (item) return item.label
  }
  return ''
}
