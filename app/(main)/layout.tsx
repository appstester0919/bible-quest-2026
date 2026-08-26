import BottomNavigation from '@/components/BottomNavigation'

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
      <BottomNavigation />
    </div>
  )
}
