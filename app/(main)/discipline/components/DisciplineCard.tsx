'use client'

/**
 * DisciplineCard — reusable surface for the 3 discipline pages.
 * Matches the DuoBible "lesson-card" component (white, 20px corners, 24px padding)
 * with optional accent stripe for category emphasis.
 */

import { ReactNode } from 'react'

type Props = {
  children: ReactNode
  accent?: 'success' | 'streak' | 'gem' | 'accent' | 'xp'
  className?: string
  title?: string
}

const ACCENT_COLOR: Record<NonNullable<Props['accent']>, string> = {
  success: '#58CC02',
  streak: '#FF9600',
  gem: '#1CB0F6',
  accent: '#CE82FF',
  xp: '#FFC800',
}

export default function DisciplineCard({
  children,
  accent,
  className = '',
  title,
}: Props) {
  const style = accent
    ? ({ ['--card-accent' as string]: ACCENT_COLOR[accent] } as React.CSSProperties)
    : undefined
  return (
    <section
      className={`discipline-card ${className}`.trim()}
      style={style}
    >
      {title && <h2 className="discipline-card-title">{title}</h2>}
      {accent && <div className="discipline-card-stripe" aria-hidden="true" />}
      <div className="discipline-card-body">{children}</div>
    </section>
  )
}