'use client'

import Link from 'next/link'
import DisciplineCard from './components/DisciplineCard'

const SUBPAGES = [
  {
    href: '/discipline/goals',
    title: '目標設定',
    desc: '課程開始前，為自己每週訂立操練目標（VIRTUE · KNOWLEDGE · SELF-CONTROL · GODLINESS · LOVE）',
    accent: 'success' as const,
    icon: '🎯',
  },
  {
    href: '/discipline/weekly',
    title: '每週操練',
    desc: '記錄本週 7 天的操練表現，每週提交給導師',
    accent: 'streak' as const,
    icon: '🔥',
  },
  {
    href: '/discipline/sharing',
    title: '分享信仰',
    desc: '記錄每週傳福音的 MESSAGE 與 DAILY SHARING',
    accent: 'gem' as const,
    icon: '💬',
  },
]

export default function DisciplineLanding() {
  return (
    <div className="page page-discipline">
      <header className="page-header">
        <h1 className="h1">成全操練</h1>
        <p className="page-subtitle">
          「成全追求」訓練課程的操練表 — 設定目標、記錄操練、分享信仰
        </p>
      </header>

      <div className="discipline-grid">
        {SUBPAGES.map((p) => (
          <Link key={p.href} href={p.href} className="discipline-link">
            <DisciplineCard accent={p.accent} title={p.title}>
              <div className="discipline-landing-icon" aria-hidden="true">
                {p.icon}
              </div>
              <p className="discipline-landing-desc">{p.desc}</p>
              <span className="discipline-landing-cta">開始 ›</span>
            </DisciplineCard>
          </Link>
        ))}
      </div>
    </div>
  )
}