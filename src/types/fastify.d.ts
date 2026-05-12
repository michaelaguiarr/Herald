import '@fastify/jwt'
import { UserRole } from '@prisma/client'

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: {
      sub: string
      role: UserRole
      organizationId: string | null
      name: string
    }
    user: {
      sub: string | null    // null when authenticated via X-Api-Key (no human user)
      role: UserRole
      organizationId: string | null
      name: string
    }
  }
}
