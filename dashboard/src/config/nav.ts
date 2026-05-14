import {
  LayoutDashboard,
  Bell,
  AlertCircle,
  Smartphone,
  Radio,
  Users,
  Building2,
  ClipboardList,
  Ban,
  type LucideIcon,
} from 'lucide-react'
import { UserRole } from '@/types/api.types'

export interface NavItem {
  path: string
  label: string
  icon: LucideIcon
  /** Empty array = visible to all roles */
  roles: UserRole[]
}

export const NAV_ITEMS: NavItem[] = [
  { path: '/dashboard',      label: 'Visão Geral',        icon: LayoutDashboard, roles: [] },
  { path: '/notifications',  label: 'Notificações',        icon: Bell,            roles: [] },
  { path: '/failed',         label: 'Falhas Definitivas',  icon: AlertCircle,     roles: [] },
  { path: '/whatsapp',       label: 'Sessões WhatsApp',    icon: Smartphone,      roles: ['OWNER', 'SUPER_ADMIN', 'ADMIN'] },
  { path: '/channels',       label: 'Canais',              icon: Radio,           roles: ['OWNER', 'SUPER_ADMIN', 'ADMIN'] },
  { path: '/users',          label: 'Usuários',            icon: Users,           roles: ['OWNER', 'SUPER_ADMIN', 'ADMIN'] },
  { path: '/organizations',  label: 'Organizações',        icon: Building2,       roles: ['OWNER', 'SUPER_ADMIN'] },
  { path: '/audit',          label: 'Audit Log',           icon: ClipboardList,   roles: ['OWNER', 'SUPER_ADMIN', 'ADMIN'] },
  { path: '/opt-outs',      label: 'Opt-outs',            icon: Ban,             roles: ['OWNER', 'SUPER_ADMIN', 'ADMIN'] },
]

export function getFilteredNavItems(role: UserRole): NavItem[] {
  return NAV_ITEMS.filter(
    (item) => item.roles.length === 0 || item.roles.includes(role)
  )
}
