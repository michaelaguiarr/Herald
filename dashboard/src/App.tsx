import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import { Toaster } from 'sonner'
import { useAuthStore } from '@/store/auth.store'
import { refresh } from '@/services/auth.service'
import ProtectedRoute from '@/router/ProtectedRoute'
import AppLayout from '@/components/layout/AppLayout'
import LoginPage from '@/pages/Login'
import DashboardPage from '@/pages/Dashboard'
import NotificationsPage from '@/pages/Notifications'
import FailedNotificationsPage from '@/pages/FailedNotifications'
import WhatsAppSessionsPage from '@/pages/WhatsAppSessions'
import ChannelsPage from '@/pages/Channels'
import UsersPage from '@/pages/Users'
import OrganizationsPage from '@/pages/Organizations'
import AuditLogPage from '@/pages/AuditLog'
import OptOutsPage from '@/pages/OptOuts'

// ─── AuthRoute — redirects already-authenticated users away from /login ───────

function AuthRoute() {
  const token = useAuthStore((s) => s.token)
  if (token) return <Navigate to="/dashboard" replace />
  return <Outlet />
}

// ─── BootLoader — silent refresh before first render ─────────────────────────
// Restores session after a page reload by exchanging the httpOnly cookie
// for a new access token, then populating the Zustand store.
// If the cookie is absent or expired, the store stays empty and
// ProtectedRoute handles the redirect to /login.

function BootLoader({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false)
  const setAuth = useAuthStore((s) => s.setAuth)

  useEffect(() => {
    refresh()
      .then(({ token, user }) => setAuth(token, user))
      .catch(() => {
        // No valid cookie — user will be redirected to /login by ProtectedRoute
      })
      .finally(() => setReady(true))
  }, [setAuth])

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-7 w-7 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  return <>{children}</>
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  return (
    <BrowserRouter basename="/herald">
      <BootLoader>
        <Routes>
          <Route element={<AuthRoute />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/failed" element={<FailedNotificationsPage />} />
              <Route path="/whatsapp" element={<WhatsAppSessionsPage />} />
              <Route path="/channels" element={<ChannelsPage />} />
              <Route path="/users" element={<UsersPage />} />
              <Route path="/organizations" element={<OrganizationsPage />} />
              <Route path="/audit" element={<AuditLogPage />} />
              <Route path="/opt-outs" element={<OptOutsPage />} />
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BootLoader>

      <Toaster richColors position="top-right" />
    </BrowserRouter>
  )
}
