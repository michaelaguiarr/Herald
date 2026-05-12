import 'dotenv/config'
import { buildApp } from './app'
import { env } from './lib/env'

async function main() {
  const app = await buildApp()

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' })
    console.log(`Herald API rodando em http://0.0.0.0:${env.PORT}`)
    console.log(`Swagger UI disponível em http://0.0.0.0:${env.PORT}/docs`)
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }
}

main()
