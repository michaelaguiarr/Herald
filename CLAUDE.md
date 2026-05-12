# Herald — Serviço de Notificações Multi-Canal

Microserviço de entrega de notificações (WhatsApp, Email, Telegram) com hierarquia organizacional de três níveis: Plataforma (OWNER), Paróquias e Comunidades. O Herald **não compõe mensagens** — recebe conteúdo 100% pronto de uma API externa e é responsável por enfileirar, entregar, rotacionar canais, fazer retry automático e alertar administradores sobre eventos críticos.

PRD completo: `notification-service-prd.md`

---

## Stack

| Camada         | Tecnologia                          |
| -------------- | ----------------------------------- |
| Runtime        | Node.js + TypeScript                |
| Framework      | Fastify                             |
| Validação      | Zod                                 |
| Autenticação   | JWT + bcrypt                        |
| WhatsApp       | Baileys                             |
| Email          | Nodemailer                          |
| Telegram       | node-telegram-bot-api               |
| Fila e retry   | BullMQ + Redis                      |
| Banco de dados | PostgreSQL 16                       |
| ORM            | Prisma                              |
| Criptografia   | Node crypto (AES-256)               |
| Real-time      | SSE (Server-Sent Events)            |
| Dashboard      | React + Recharts                    |
| Infra          | Docker Compose                      |
| Documentação   | Swagger / OpenAPI (@fastify/swagger) |

---

## Fases de Desenvolvimento

### Fase 1 — Fundação
Setup, autenticação e gestão de usuários/organizações.

- TypeScript + Fastify + Docker Compose (API + Postgres + Redis)
- Migrations Prisma com o modelo de dados completo
- Auth JWT: login, refresh, 4 perfis (OWNER, SUPER_ADMIN, ADMIN, OPERATOR)
- Recuperação de senha por email com token de 1h
- CRUD de organizações (OWNER)
- CRUD de usuários com hierarquia de criação
- Middleware de isolamento por `organization_id`
- Swagger/OpenAPI habilitado
/
### Fase 2 — Entrega via Email e Fila
Fluxo principal de notificação com o canal mais simples.

- `POST /v1/notifications/send` aceitando mensagem pronta
- Worker BullMQ processando e entregando via Email (Nodemailer)
- Registro de `notification_attempt`
- Status: PENDENTE → ENVIADO / FALHOU
- `GET /v1/notifications` e `GET /v1/notifications/{id}`
- CRUD de canais (Email) com credentials criptografadas (AES-256)

### Fase 3 — WhatsApp: Sessão e Entrega
Canal mais complexo operacional, sem anti-banimento ainda.

- Integração Baileys com sessão persistida em volume Docker
- CRUD de canais WhatsApp
- Onboarding via QR Code + SSE para atualização a cada 30s
- Status de sessão: WARMING, ACTIVE, DISCONNECTED, BANNED
- Entrega de mensagens via worker
- `POST /v1/channels/{id}/reconnect`
- Mini-dashboard de sessões (React) — antecipado para testar QR Code

### Fase 4 — Telegram, Retry e Alertas
Resiliência completa da entrega.

- Integração Telegram Bot API: entrega de notificações e alertas
- CRUD de canais Telegram
- Rotação de pool em falha de WhatsApp
- Retry automático em 3 ciclos via BullMQ delayed jobs: +1h → +6h → +24h
- Status `FALHOU_DEFINITIVO`
- `POST /v1/notifications/{id}/retry`
- Sistema de alertas: falha definitiva, banimento, sessão caída
- `audit_log` em todas as ações relevantes

### Fase 5 — Anti-Banimento e Agendamento
Proteção dos números WhatsApp e funcionalidades avançadas de envio.

- Rate limiting por número (diário + por hora)
- Aquecimento de 7 dias automático (WARMING → ACTIVE)
- Detecção de banimento com desativação automática
- Bloqueio de envio ao mesmo destinatário por números diferentes no mesmo dia
- `POST /v1/notifications/schedule` (BullMQ delayed jobs)
- `POST /v1/notifications/broadcast` para toda a paróquia
- API Key por organização (`X-Api-Key`) para chamadas da API externa

### Fase 6 — Dashboard Completo e Auditoria
Produto entregável para o cliente final.

- API de métricas filtrada por escopo (`/v1/dashboard/*`)
- Frontend React completo com Recharts
- Fila de `FALHOU_DEFINITIVO` com painel de reenvio
- Visibilidade de `audit_log` por escopo de perfil
- Polimento de UX: estados de loading, tratamento de erros, feedback visual

---

## Estrutura de Pastas

```
herald/
├── src/
│   ├── http/
│   │   ├── routes/
│   │   │   ├── auth.ts
│   │   │   ├── organizations.ts
│   │   │   ├── users.ts
│   │   │   ├── channels.ts
│   │   │   ├── notifications.ts
│   │   │   ├── dashboard.ts
│   │   │   └── audit-logs.ts
│   │   ├── middlewares/
│   │   │   ├── authenticate.ts       # valida JWT, injeta req.user
│   │   │   └── scope-guard.ts        # isolamento por organization_id
│   │   └── errors/
│   │       └── handler.ts
│   ├── workers/
│   │   ├── notification.worker.ts    # processa jobs da fila
│   │   └── scheduler.worker.ts      # processa delayed jobs
│   ├── queues/
│   │   ├── notification.queue.ts
│   │   └── alert.queue.ts
│   ├── channels/
│   │   ├── whatsapp/
│   │   │   ├── baileys.client.ts     # sessão Baileys + QR Code
│   │   │   ├── session.manager.ts   # reconexão, detecção de ban
│   │   │   └── rate-limiter.ts      # anti-banimento
│   │   ├── email/
│   │   │   └── nodemailer.client.ts
│   │   └── telegram/
│   │       └── telegram.client.ts
│   ├── alerts/
│   │   └── alert.service.ts          # envia alertas críticos via Telegram
│   ├── lib/
│   │   ├── prisma.ts
│   │   ├── redis.ts
│   │   ├── jwt.ts
│   │   └── crypto.ts                 # AES-256 para credentials
│   ├── schemas/                       # schemas Zod compartilhados
│   ├── types/
│   │   └── fastify.d.ts              # augmentation de req.user
│   └── app.ts                        # factory do Fastify
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── dashboard/                         # frontend React
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   └── hooks/
│   └── package.json
├── whatsapp-sessions/                 # volume Docker — não commitar
├── docker-compose.yml
├── docker-compose.dev.yml
├── Dockerfile
├── .env.example
└── CLAUDE.md
```

---

## Comandos

### Desenvolvimento

```bash
# Subir infra (Postgres + Redis) sem a API
docker compose -f docker-compose.dev.yml up -d

# Rodar a API em watch mode
npm run dev

# Rodar o dashboard
cd dashboard && npm run dev
```

### Banco de dados

```bash
# Criar e aplicar migration
npx prisma migrate dev --name <nome>

# Aplicar migrations em produção
npx prisma migrate deploy

# Abrir Prisma Studio
npx prisma studio
```

### Produção

```bash
# Subir tudo
docker compose up -d

# Ver logs da API
docker compose logs -f api

# Rebuild da API após mudança
docker compose up -d --build api
```

### Testes

```bash
npm test              # todos os testes
npm run test:unit     # unitários
npm run test:int      # integração (requer Postgres + Redis rodando)
npm run test:e2e      # end-to-end
```

---

## Convenções de Código

### Arquivos e pastas
- Kebab-case para arquivos: `notification.worker.ts`, `rate-limiter.ts`
- Um arquivo por responsabilidade — sem "utils.ts" genérico
- Schemas Zod ficam em `src/schemas/` e são reutilizados entre route e worker

### TypeScript
- `strict: true` sempre ligado
- Sem `any` — usar `unknown` e narrowing
- Enums do Prisma importados diretamente (não redefinir no código)
- Tipos de request/response derivados do schema Zod via `z.infer<>`

### Fastify
- Cada domínio tem seu próprio plugin registrado via `fastify.register()`
- Validação de input feita via schema Zod na rota, nunca no service
- Erros de negócio lançados como `FastifyError` com `statusCode` explícito
- `preHandler` de autenticação + `preHandler` de scope-guard encadeados

### Banco de dados
- Queries sempre filtradas por `organizationId` — exceto para OWNER
- Nunca deletar fisicamente: usar `active: false`
- `audit_log` escrito dentro da mesma transação Prisma da ação principal quando possível

### Filas (BullMQ)
- Um job por notificação
- `attempts` definido no job, não no worker
- `backoff` customizado por ciclo (1h, 6h, 24h) — não usar o exponencial padrão
- Workers idempotentes: verificar status antes de processar

### Segurança
- Credentials de canais sempre criptografadas antes de persistir, descriptografadas só no momento do envio
- `organizationId` do token JWT — nunca do body do request
- Logs nunca expõem credentials, tokens ou hashes de senha

### Variáveis de ambiente
- Todas declaradas e validadas com Zod no startup (fail-fast)
- Prefixo por domínio: `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CRYPTO_KEY`
- `.env.example` sempre atualizado com cada nova variável
