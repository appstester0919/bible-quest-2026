export default function SignupPage() {
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
        <h1 style={{ fontSize: '1.5rem', marginBottom: '16px', color: 'var(--color-primary)' }}>
          Sign Up for Bible Quest
        </h1>
        <p style={{ color: 'var(--color-muted)', marginBottom: '24px' }}>
          Start your Bible reading adventure
        </p>
        <a 
          href="/"
          style={{
            backgroundColor: 'var(--color-success)',
            color: 'white',
            padding: '14px 24px',
            borderRadius: '12px',
            fontWeight: 700,
            border: 'none',
            display: 'block'
          }}
        >
          Go to Home
        </a>
      </div>
    </main>
  );
}
