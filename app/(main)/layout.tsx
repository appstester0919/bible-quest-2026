import BottomNavigation from '@/components/BottomNavigation'
import ThemeFab from '@/components/ThemeFab'

export default function MainLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      className="min-h-screen"
      style={{
        // Reserve room for the 64px docked nav + iOS safe area
        paddingBottom: 'calc(72px + env(safe-area-inset-bottom, 16px))',
      }}
    >
      <main>{children}</main>
      {/* 「Dark/light mode 的控制器只有在讀經版面和屬靈書版面看到，在dashboard
          版面和操練版面都沒有控制器」

          A per-page control was the wrong shape: it existed on two of seven
          screens and the other five silently stayed light forever. Rendering it
          once in the shared (main) layout gives every surface under it —
          dashboard, discipline, calendar, settings, partner, links — the same
          control without each page having to remember to add one.

          The reader and the book keep their own in-header control, where a
          thumb naturally lands on those two reading screens. */}
      <ThemeFab />
      <BottomNavigation />
    </div>
  )
}
