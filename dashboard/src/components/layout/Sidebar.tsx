import { NavLink } from 'react-router-dom'
import { LogOut } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { useAuthStore } from '@/store/auth.store'
import { useLogout } from '@/hooks/useLogout'
import { getFilteredNavItems } from '@/config/nav'

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Owner',
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  OPERATOR: 'Operador',
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

export default function Sidebar() {
  const user = useAuthStore((s) => s.user)
  const logout = useLogout()

  if (!user) return null

  const navItems = getFilteredNavItems(user.role)

  return (
    <aside className="hidden lg:flex flex-col w-60 min-h-screen bg-white border-r border-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-border">
        <span className="text-xl">📨</span>
        <span className="font-bold text-lg text-primary">Herald</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                )
              }
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
            </NavLink>
          )
        })}
      </nav>

      <Separator />

      {/* User section */}
      <div className="p-3 space-y-1">
        <div className="flex items-center gap-3 px-3 py-2 rounded-md">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs bg-primary/10 text-primary">
              {getInitials(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-muted-foreground">{ROLE_LABEL[user.role] ?? user.role}</p>
          </div>
        </div>

        <button
          onClick={logout}
          className={cn(
            'flex w-full items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
            'text-muted-foreground hover:bg-destructive/10 hover:text-destructive'
          )}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          Sair
        </button>
      </div>
    </aside>
  )
}
