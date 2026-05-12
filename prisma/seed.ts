import { PrismaClient, UserRole } from '@prisma/client'
import bcrypt from 'bcrypt'

const prisma = new PrismaClient()

async function main() {
  const email = process.env.SEED_OWNER_EMAIL ?? 'admin@herald.app'
  const name = process.env.SEED_OWNER_NAME ?? 'Administrador'
  const password = process.env.SEED_OWNER_PASSWORD ?? 'Admin@1234'

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    console.log(`OWNER já existe: ${email}`)
    return
  }

  const passwordHash = await bcrypt.hash(password, 12)

  await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: UserRole.OWNER,
      organizationId: null,
    },
  })

  console.log(`OWNER criado: ${email}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
