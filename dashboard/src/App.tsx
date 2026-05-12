import { useState, useEffect } from 'react'
import WhatsAppSessions from './components/WhatsAppSessions'

const API = ''  // proxied via Vite to http://localhost:3000

interface AuthState {
  token: string
  organizationId: string | null
  role: string
}

function parseJwt(token: string) {
  try {
    return JSON.parse(atob(token.split('.')[1]))
  } catch {
    return null
  }
}

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(() => {
    const stored = localStorage.getItem('herald_token')
    if (!stored) return null
    const payload = parseJwt(stored)
    if (!payload || payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('herald_token')
      return null
    }
    return { token: stored, organizationId: payload.organizationId, role: payload.role }
  })

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Erro ao autenticar')
      localStorage.setItem('herald_token', data.token)
      const payload = parseJwt(data.token)
      setAuth({ token: data.token, organizationId: payload?.organizationId, role: payload?.role })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  function handleLogout() {
    localStorage.removeItem('herald_token')
    setAuth(null)
  }

  if (!auth) {
    return (
      <div style={styles.loginWrap}>
        <div style={styles.loginCard}>
          <h1 style={styles.loginTitle}>Herald</h1>
          <p style={styles.loginSub}>Dashboard de Sessões WhatsApp</p>
          <form onSubmit={handleLogin} style={styles.form}>
            <label style={styles.label}>E-mail</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@herald.app"
              required
            />
            <label style={{ ...styles.label, marginTop: 12 }}>Senha</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
            {error && <p style={styles.errorMsg}>{error}</p>}
            <button
              type="submit"
              disabled={loading}
              style={{ ...styles.btn, marginTop: 16, width: '100%' }}
            >
              {loading ? 'Autenticando…' : 'Entrar'}
            </button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.root}>
      <header style={styles.header}>
        <span style={styles.headerTitle}>Herald Dashboard</span>
        <button onClick={handleLogout} style={styles.logoutBtn}>Sair</button>
      </header>
      <main style={styles.main}>
        <WhatsAppSessions token={auth.token} />
      </main>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  loginWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
  },
  loginCard: {
    background: '#fff',
    borderRadius: 12,
    padding: '36px 32px',
    width: 360,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  loginTitle: { fontSize: 28, fontWeight: 700, color: '#1d4ed8' },
  loginSub: { fontSize: 14, color: '#6b7280', marginTop: 4, marginBottom: 24 },
  form: { display: 'flex', flexDirection: 'column' },
  label: { fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 },
  errorMsg: { color: '#dc2626', fontSize: 13, marginTop: 8 },
  btn: { background: '#1d4ed8', color: '#fff', padding: '10px 16px', borderRadius: 8, fontSize: 14 },
  root: { minHeight: '100vh' },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '14px 24px',
    background: '#1d4ed8',
    color: '#fff',
  },
  headerTitle: { fontWeight: 700, fontSize: 18 },
  logoutBtn: { background: 'rgba(255,255,255,0.2)', color: '#fff', fontSize: 13 },
  main: { padding: '24px' },
}