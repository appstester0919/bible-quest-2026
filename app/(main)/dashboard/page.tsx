export default function DashboardPage() {
  return (
    <main style={{ 
      minHeight: '100vh', 
      padding: '24px',
      backgroundColor: 'var(--color-background)'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '20px',
        padding: '32px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)'
      }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
          📖 Bible Quest Dashboard
        </h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: '24px' }}>
          Welcome to your reading journey!
        </p>
        <div style={{ 
          backgroundColor: 'var(--color-streak)', 
          color: 'white',
          padding: '16px 24px',
          borderRadius: '12px',
          marginBottom: '16px'
        }}>
          🔥 Streak: 0 days
        </div>
        <div style={{ 
          backgroundColor: 'var(--color-xp)', 
          color: 'var(--color-primary)',
          padding: '8px 16px',
          borderRadius: '9999px',
          display: 'inline-block',
          marginBottom: '24px'
        }}>
          ⭐ XP: 0
        </div>
      </div>
    </main>
  );
}
