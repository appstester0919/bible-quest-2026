'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function BottomNavigation() {
  const pathname = usePathname()
  const [isDesktop, setIsDesktop] = useState(false)

  useEffect(() => {
    const checkScreenSize = () => setIsDesktop(window.innerWidth >= 768)
    checkScreenSize()
    window.addEventListener('resize', checkScreenSize)
    return () => window.removeEventListener('resize', checkScreenSize)
  }, [])

  const navItems = [
    { href: '/dashboard', icon: '📊', label: '總覽' },
    { href: '/read',       icon: '📖', label: '讀經' },
    { href: '/calendar',   icon: '📅', label: '日曆' },
    { href: '/settings',   icon: '⚙️', label: '設定' },
  ]

  return (
    <div
      style={{
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 40,
        backgroundColor: 'white',
        borderRadius: '999px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        border: '2px solid #22c55e',
        padding: isDesktop ? '12px 24px' : '10px 16px',
        maxWidth: '95vw',
        width: isDesktop ? 'auto' : '90vw',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: isDesktop ? '8px' : '4px',
          justifyContent: 'space-between',
        }}
      >
        {navItems.map((item, index) => {
          const isActive = pathname === item.href
          return (
            <div key={item.href} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <Link
                href={item.href}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  flexDirection: isDesktop ? 'row' : 'column',
                  gap: isDesktop ? '8px' : '2px',
                  padding: isDesktop ? '10px 20px' : '8px 4px',
                  borderRadius: '999px',
                  textDecoration: 'none',
                  backgroundColor: isActive ? '#22c55e' : 'transparent',
                  color: isActive ? 'white' : '#6b7280',
                  fontWeight: 600,
                  fontSize: isDesktop ? '15px' : '11px',
                  border: isActive ? 'none' : '1px solid transparent',
                  transition: 'all 0.25s ease',
                  minWidth: isDesktop ? '90px' : 'auto',
                  width: '100%',
                  justifyContent: 'center',
                }}
              >
                <span style={{ fontSize: isDesktop ? '20px' : '18px' }}>{item.icon}</span>
                <span style={{ fontSize: isDesktop ? '15px' : '10px' }}>{item.label}</span>
              </Link>
              {index < navItems.length - 1 && isDesktop && (
                <div style={{ width: '1px', height: '32px', backgroundColor: '#e5e7eb', margin: '0 8px' }} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
