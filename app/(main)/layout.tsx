import BottomNavigation from '@/components/BottomNavigation'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-20">
      <main>{children}</main>
      <BottomNavigation />
    </div>
  )
}
