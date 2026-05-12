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
      sub: string
      role: UserRole
      organizationId: string | null
      name: string
    }
  }
}
