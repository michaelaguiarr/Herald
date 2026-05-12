import { useState, useEffect } from 'react'
import Summary from './pages/Summary'
import FailedQueue from './pages/FailedQueue'
import AuditLog from './pages/AuditLog'
import WhatsAppSessions from './components/WhatsAppSessions'

// ─── Auth helpers ─────────────────────────────────────────────────────────────

function parseJwt(token: string) {
  try { return JSON.parse(atob(token.split('.')[1])) } catch { return null }
}

interface AuthState { token: string; role: string; name: string }

function getStoredAuth(): AuthState | null {
  const stored = localStorage.getItem('herald_token')
  if (!stored) return null
  const payload = parseJwt(stored)
  if (!payload || payload.exp * 1000 < Date.now()) {
    localStorage.removeItem('herald_token')
    return null
  }
  return { token: stored, role: payload.role, name: payload.name ?? 'Usuário' }
}

// ─── Tab navigation ───────────────────────────────────────────────────────────

type Tab = 'summary' | 'failed' | 'whatsapp' | 'audit'

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'summary',  label: 'Visão Geral',          icon: '📊' },
  { id: 'failed',   label: 'Falhas Definitivas',    icon: '🔴' },
  { id: 'whatsapp', label: 'Sessões WhatsApp',       icon: '📱' },
  { id: 'audit',    label: 'Audit Log',              icon: '📋' },
]

// ─── Login form ───────────────────────────────────────────────────────────────

function LoginPage({ onLogin }: { onLogin: (auth: AuthState) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true); setError('')
    try {
      const res = await fetch('/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.message ?? 'Erro ao autenticar')
      localStorage.setItem('herald_token', data.token)
      const payload = parseJwt(data.token)
      onLogin({ token: data.token, role: payload?.role, name: payload?.name ?? 'Usuário' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro desconhecido')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f4f6f9' }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '40px 36px', width: 360, boxShadow: '0 4px 24px rgba(0,0,0,0.09)' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>📨</div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: '#1d4ed8' }}>Herald</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginTop: 4 }}>Dashboard de Notificações</p>
        </div>
        <form onSubmit={handleSubmit}>
          <label style={s.label}>E-mail</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@herald.app" required style={s.input} />
          <label style={{ ...s.label, marginTop: 14 }}>Senha</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••" required style={s.input} />
          {error && <p style={{ color: '#dc2626', fontSize: 13, marginTop: 10 }}>{error}</p>}
          <button type="submit" disabled={loading} style={{ ...s.btn, marginTop: 20, width: '100%' }}>
            {loading ? 'Autenticando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── Main app ─────────────────────────────────────────────────────────────────

export default function App() {
  const [auth, setAuth] = useState<AuthState | null>(getStoredAuth)
  const [activeTab, setActiveTab] = useState<Tab>('summary')

  // Auto-refresh token check every minute
  useEffect(() => {
    const id = setInterval(() => {
      if (auth && !getStoredAuth()) {
        setAuth(null)
      }
    }, 60_000)
    return () => clearInterval(id)
  }, [auth])

  if (!auth) return <LoginPage onLogin={setAuth} />

  return (
    <div style={{ minHeight: '100vh', background: '#f4f6f9' }}>
      {/* Header */}
      <header style={{ background: '#1d4ed8', color: '#fff', padding: '0 24px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 56, boxShadow: '0 2px 8px rgba(0,0,0,0.12)' }}>
        <span style={{ fontWeight: 700, fontSize: 18 }}>📨 Herald Dashboard</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ fontSize: 13, opacity: 0.85 }}>{auth.name} ({auth.role})</span>
          <button onClick={() => { localStorage.removeItem('herald_token'); setAuth(null) }}
            style={{ background: 'rgba(255,255,255,0.2)', color: '#fff', border: 'none', borderRadius: 6, padding: '5px 12px', fontSize: 13, cursor: 'pointer' }}>
            Sair
          </button>
        </div>
      </header>

      {/* Tab bar */}
      <nav style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '0 24px', display: 'flex', gap: 0 }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              border: 'none', background: 'transparent', cursor: 'pointer',
              padding: '14px 18px', fontSize: 14, fontWeight: 500,
              color: activeTab === tab.id ? '#1d4ed8' : '#6b7280',
              borderBottom: activeTab === tab.id ? '2px solid #1d4ed8' : '2px solid transparent',
              transition: 'all 0.15s',
            }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </nav>

      {/* Page content */}
      <main style={{ padding: '28px 24px', maxWidth: 1200, margin: '0 auto' }}>
        {activeTab === 'summary'  && <Summary token={auth.token} />}
        {activeTab === 'failed'   && <FailedQueue token={auth.token} />}
        {activeTab === 'whatsapp' && <WhatsAppSessions token={auth.token} />}
        {activeTab === 'audit'    && <AuditLog token={auth.token} />}
      </main>
    </div>
  )
}

const s: Record<string, React.CSSProperties> = {
  label: { display: 'block', fontSize: 13, fontWeight: 500, color: '#374151', marginBottom: 4 },
  input: { display: 'block', width: '100%', padding: '9px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, outline: 'none', boxSizing: 'border-box' },
  btn: { display: 'block', background: '#1d4ed8', color: '#fff', border: 'none', borderRadius: 8, padding: '10px 16px', fontSize: 14, fontWeight: 600, cursor: 'pointer' },
}
