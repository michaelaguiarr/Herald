import { NavLink } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/store/auth.store'
import { getFilteredNavItems } from '@/config/nav'

export default function BottomNav() {
  const user = useAuthStore((s) => s.user)
  if (!user) return null

  const navItems = getFilteredNavItems(user.role)

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-border">
      <div className="flex overflow-x-auto scrollbar-hide">
        {navItems.map((item) => {
          const Icon = item.icon
          return (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center gap-0.5 px-3 py-2 min-w-[4rem] flex-shrink-0 text-xs font-medium transition-colors',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'flex items-center justify-center h-6 w-6 rounded-md transition-colors',
                      isActive && 'bg-primary/10'
                    )}
                  >
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="truncate max-w-[4rem] text-center leading-tight">
                    {item.label.split(' ')[0]}
                  </span>
                </>
              )}
            </NavLink>
          )
        })}
      </div>
    </nav>
  )
}
