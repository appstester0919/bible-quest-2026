export default function Home() {
  return (
    <main style={{ 
      minHeight: '100vh', 
      display: 'flex', 
      flexDirection: 'column',
      alignItems: 'center', 
      justifyContent: 'center',
      padding: '24px'
    }}>
      <div style={{
        backgroundColor: 'white',
        borderRadius: '20px',
        padding: '32px',
        maxWidth: '400px',
        width: '100%',
        textAlign: 'center',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.12)'
      }}>
        <div style={{
          width: '64px',
          height: '64px',
          backgroundColor: 'var(--color-success)',
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
          fontSize: '32px'
        }}>
          📖
        </div>
        <h1 style={{ fontSize: '2rem', marginBottom: '8px', color: 'var(--color-primary)' }}>
          Bible Quest 2026
        </h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: '24px' }}>
          Duolingo-inspired Bible reading app
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
          <a 
            href="/login"
            style={{
              backgroundColor: 'var(--color-success)',
              color: 'white',
              padding: '14px 24px',
              borderRadius: '12px',
              fontWeight: 700,
              border: 'none',
              display: 'inline-block'
            }}
          >
            Login
          </a>
          <a 
            href="/signup"
            style={{
              backgroundColor: 'white',
              color: 'var(--color-primary)',
              padding: '14px 24px',
              borderRadius: '12px',
              fontWeight: 700,
              border: '2px solid var(--color-primary)',
              display: 'inline-block'
            }}
          >
            Sign Up
          </a>
        </div>
      </div>
      <p style={{ marginTop: '24px', color: 'var(--color-muted)', fontSize: '14px' }}>
        Development server running on localhost:3000
      </p>
    </main>
  );
}
