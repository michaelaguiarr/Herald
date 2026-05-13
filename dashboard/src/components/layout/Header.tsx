import { LogOut } from 'lucide-react'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '@/store/auth.store'
import { useLogout } from '@/hooks/useLogout'

function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map((n) => n[0])
    .join('')
    .toUpperCase()
}

export default function Header() {
  const user = useAuthStore((s) => s.user)
  const logout = useLogout()
  if (!user) return null

  return (
    <header className="lg:hidden flex items-center justify-between px-4 py-3 bg-white border-b border-border sticky top-0 z-40">
      <div className="flex items-center gap-2">
        <span className="text-lg">📨</span>
        <span className="font-bold text-primary">Herald</span>
      </div>

      <div className="flex items-center gap-2">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="text-xs bg-primary/10 text-primary">
            {getInitials(user.name)}
          </AvatarFallback>
        </Avatar>
        <Button
          variant="ghost"
          size="icon"
          onClick={logout}
          title="Sair"
          className="h-8 w-8 text-muted-foreground hover:text-destructive"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  )
}
