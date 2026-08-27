'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'

// ─── Icons (inline SVG, stroke-based — replaces emoji per DESIGN.md) ─────────

type IconProps = { size?: number }

function Icon({
  size = 22,
  children,
}: {
  size?: number
  children: React.ReactNode
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const DashboardIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <line x1="18" y1="20" x2="18" y2="10" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </Icon>
)

const BookIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </Icon>
)

const CalendarIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <line x1="16" y1="2" x2="16" y2="6" />
    <line x1="8" y1="2" x2="8" y2="6" />
    <line x1="3" y1="10" x2="21" y2="10" />
  </Icon>
)

const MoreIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <circle cx="5" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.7" fill="currentColor" stroke="none" />
  </Icon>
)

const SettingsIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <line x1="4" y1="21" x2="4" y2="14" />
    <line x1="4" y1="10" x2="4" y2="3" />
    <line x1="12" y1="21" x2="12" y2="12" />
    <line x1="12" y1="8" x2="12" y2="3" />
    <line x1="20" y1="21" x2="20" y2="16" />
    <line x1="20" y1="12" x2="20" y2="3" />
    <line x1="1" y1="14" x2="7" y2="14" />
    <line x1="9" y1="8" x2="15" y2="8" />
    <line x1="17" y1="16" x2="23" y2="16" />
  </Icon>
)

const ShareIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
    <polyline points="16 6 12 2 8 6" />
    <line x1="12" y1="2" x2="12" y2="15" />
  </Icon>
)

// 「操練」tab icon — heart with flame (combines love + streak metaphor)
const PracticeIcon = ({ size }: IconProps) => (
  <Icon size={size}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    <path d="M12 8c-1.5-2-4-2-4 0 0 1.5 1.5 3 4 5 2.5-2 4-3.5 4-5 0-2-2.5-2-4 0" />
  </Icon>
)

const CloseIcon = ({ size = 20 }: IconProps) => (
  <Icon size={size}>
    <line x1="6" y1="6" x2="18" y2="18" />
    <line x1="18" y1="6" x2="6" y2="18" />
  </Icon>
)

// ─── Nav model ────────────────────────────────────────────────────────────────

const TOP_TABS = [
  {
    href: '/dashboard',
    label: '總覽',
    TabIcon: DashboardIcon,
    accent: '#FF9600',
  },
  { href: '/read', label: '讀經', TabIcon: BookIcon, accent: '#58CC02' },
  {
    href: '/calendar',
    label: '日曆',
    TabIcon: CalendarIcon,
    accent: '#1CB0F6',
  },
  {
    href: '/discipline',
    label: '操練',
    TabIcon: PracticeIcon,
    accent: '#CE82FF',
  },
] as const

/** Routes served inside the「更多」sheet — any of these active ⇒ 更多 tab glows.
 *  夥伴 (/partner) 已落架（2026-08）：功能被群組覆蓋且無入口；route 保留，
 *  日後認真發展夥伴時喺 SHEET_GRID 加返 { href:'/partner', label:'夥伴' } */
const SHEET_ROUTE_PREFIXES: string[] = []

export default function BottomNavigation() {
  const pathname = usePathname()
  const [sheetOpen, setSheetOpen] = useState(false)
  const [navHidden, setNavHidden] = useState(false)
  const [copied, setCopied] = useState(false)
  const lastScrollY = useRef(0)

  // Close the sheet on navigation; reset transient nav state for the new page
  useEffect(() => {
    setSheetOpen(false)
    setNavHidden(false)
    lastScrollY.current = window.scrollY
  }, [pathname])

  useEffect(() => {
    if (!sheetOpen) return
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSheetOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKey)
    }
  }, [sheetOpen])

  // Hide-on-scroll-down / show-on-scroll-up (keeps scripture reading clean)
  useEffect(() => {
    lastScrollY.current = window.scrollY
    const onScroll = () => {
      const y = window.scrollY
      const delta = y - lastScrollY.current
      lastScrollY.current = y
      if (y < 96) {
        setNavHidden(false)
        return
      }
      if (delta > 8) setNavHidden(true)
      else if (delta < -8) setNavHidden(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const moreActive =
    sheetOpen || SHEET_ROUTE_PREFIXES.some((p) => pathname.startsWith(p))

  const shareApp = async () => {
    const url = window.location.origin
    try {
      if (navigator.share) {
        await navigator.share({ title: 'DuoBible 聖經速讀', url })
        return
      }
      throw new Error('no navigator.share')
    } catch {
      try {
        await navigator.clipboard.writeText(url)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch {
        /* clipboard unavailable — silently ignore */
      }
    }
  }

  return (
    <>
      <nav
        className="bottom-nav-v2"
        style={{
          transform:
            navHidden && !sheetOpen ? 'translateY(110%)' : 'translateY(0)',
        }}
        aria-label="主導覽"
      >
        <div className="bottom-nav-inner">
          {TOP_TABS.map(({ href, label, TabIcon, accent }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`bottom-tab${active ? ' bottom-tab-active' : ''}`}
                style={{ '--tab-accent': accent } as React.CSSProperties}
                aria-current={active ? 'page' : undefined}
              >
                <TabIcon />
                <span>{label}</span>
              </Link>
            )
          })}
          <button
            type="button"
            className={`bottom-tab${moreActive ? ' bottom-tab-active' : ''}`}
            style={{ '--tab-accent': '#1F2937' } as React.CSSProperties}
            aria-expanded={sheetOpen}
            aria-haspopup="dialog"
            onClick={() => setSheetOpen((o) => !o)}
          >
            <MoreIcon />
            <span>更多</span>
          </button>
        </div>
      </nav>

      {sheetOpen && (
        <div
          className="nav-sheet-backdrop animate-fade-in"
          onClick={() => setSheetOpen(false)}
        >
          <div
            className="nav-sheet animate-sheet-up"
            role="dialog"
            aria-modal="true"
            aria-label="更多功能"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="nav-sheet-handle" aria-hidden="true" />
            <div className="nav-sheet-head">
              <span className="h-section">更多</span>
              <button
                type="button"
                className="btn-icon nav-sheet-close"
                aria-label="關閉"
                onClick={() => setSheetOpen(false)}
              >
                <CloseIcon />
              </button>
            </div>

            <div className="nav-sheet-grid">
              {/* 夥伴已落架（見 SHEET_ROUTE_PREFIXES 註）；要加返喺度開一格 */}
              <Link
                href="/settings"
                className="more-item"
                onClick={() => setSheetOpen(false)}
              >
                <span className="more-item-icon more-item-icon-accent">
                  <SettingsIcon size={20} />
                </span>
                <span className="more-item-label">設定</span>
              </Link>
              <button type="button" className="more-item" onClick={shareApp}>
                <span className="more-item-icon more-item-icon-streak">
                  <ShareIcon size={20} />
                </span>
                <span className="more-item-label">
                  {copied ? '已複製 ✓' : '分享'}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
