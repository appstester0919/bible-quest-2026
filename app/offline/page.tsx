'use client'

export default function OfflinePage() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] px-4 text-center">
      <div className="text-6xl mb-4">📡</div>
      <h1 className="text-2xl font-extrabold text-[var(--color-primary)] mb-2">目前離線</h1>
      <p className="text-[var(--color-muted)] mb-6">
        請連接網絡後再試<br />
        你的讀經進度已保存
      </p>
      <button
        onClick={() => window.location.reload()}
        className="py-3 px-6 bg-[var(--color-success)] text-white rounded-xl font-extrabold shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all"
      >
        重新嘗試
      </button>
    </div>
  )
}
