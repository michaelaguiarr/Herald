import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/auth.store'
import { logout as logoutApi } from '@/services/auth.service'

export function useLogout() {
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate = useNavigate()

  return async function handleLogout() {
    try {
      await logoutApi()
    } catch {
      // If the server call fails (network error, already expired),
      // we still clear local state so the user can log in again.
    }
    clearAuth()
    navigate('/login', { replace: true })
  }
}
