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

---

## Bug Fixes Aplicados (Fase 3)

Bugs encontrados e corrigidos durante a implementação e testes da Fase 3.
O histórico completo está nos commits — esta seção serve como referência rápida.

| Bug | Causa | Correção aplicada |
| --- | ----- | ----------------- |
| **BANNED detection incorreta** | `loggedOut (401)` era mapeado para BANNED, mas significa logout voluntário pelo celular — não banimento | `loggedOut` → DISCONNECTED (pode reconectar via QR); apenas `forbidden (403)` → BANNED |
| **Race condition no reconnect** | `disconnect()` chamava `socket.end()` e o evento `connection.update: close` chegava assincronamente, gravando DISCONNECTED no DB após o status WARMING já ter sido setado pelo `/reconnect` | Socket capturado em variável local no closure de `connect()`; handler verifica `this.socket !== socket` antes de processar — eventos de socket substituído são descartados |
| **JID resolution (LID)** | `onWhatsApp()` retorna `results[0].jid` com o JID canônico do WA que em Baileys v7 pode ser LID-based (`@lid`); enviávamos para o JID raw (`@s.whatsapp.net`) e a mensagem era descartada silenciosamente | `resolvedJid = check.jid \|\| jid` — usa sempre o JID retornado pelo WA |
| **`getMessage` ausente no socket config** | Sem `getMessage`, Baileys falha ao tentar recuperar mensagens pendentes no reconnect, fecha sessões Signal e gera `Decrypted message with closed session` em loop | Adicionado `getMessage: async () => ({ conversation: '' })` ao `makeWASocket` |
| **Baileys v7 + Node.js v26 incompatibilidade** | `whatsapp-rust-bridge@0.5.3` só exporta condição `"import"` (ESM); Node.js v26 + tsx CJS register lança `ERR_PACKAGE_PATH_NOT_EXPORTED` | Patch `patches/whatsapp-rust-bridge+0.5.3.patch` adiciona `"default": "./dist/index.js"`; `patch-package` aplica automaticamente no `postinstall`; `tsconfig.json` migrado para `NodeNext` |
| **`result.status` ignorado no envio** | `socket.sendMessage()` retornava sem exceção mesmo quando WA server rejeitava (`status=0 ERROR`) ou quando Baileys não gerava ID de mensagem — worker marcava ENVIADO incondicionalmente | Verificações adicionadas: `!result?.key?.id` → lança erro; `result.status === 0` → lança erro com mensagem explícita |
| **`onWhatsApp` bypassado silenciosamente** | Bloco try/catch engolia qualquer exceção de `onWhatsApp` que não fosse exatamente "não encontrado" — número inválido ou erros de sessão faziam o envio prosseguir sem verificação | Erro "não encontrado" re-lançado; demais erros logam `raw=` e `resolved=` para diagnóstico; envio prossegue mas com aviso explícito no log |
| **Retry bloqueado para status ENVIADO** | Endpoint `/retry` só aceitava `FALHOU` ou `FALHOU_DEFINITIVO`; após ENVIADO sem entrega real o operador não conseguia reenviar | `ENVIADO` adicionado à lista de statuses retentáveis — ENVIADO confirma apenas que Baileys não lançou exceção, não que o destinatário recebeu |

---

## Dívidas Técnicas Documentadas

| Item | Impacto | Resolver na |
| ---- | ------- | ----------- |
| ~~`channel.sentToday` nunca é zerado~~ | ~~Rate limiting do Phase 5 bloqueará envios após o 1º dia~~ | ✅ Resolvido — cron `daily-reset-sent-today` (BullMQ, `0 0 * * *` UTC) em `scheduler.worker.ts` |
| ~~`notificationQueue` com `attempts: 1`~~ | ~~Retry ciclos precisam de `attempts: 4` + backoff~~ | ✅ Resolvido — pré-Fase 4 |
| `notification_attempt` sem canal disponível | Falha por "sem canal" não gera attempt (FK obrigatório) — rastreamento incompleto | Fase 4/5 — avaliar tornar `channelId` nullable ou criar tabela de eventos |
| `POST /v1/notifications/send` usa JWT | API externa deveria usar `X-Api-Key` por organização | Fase 5 — implementar middleware de API Key e migrar autenticação desse endpoint |
| SSE `/qrcode` com sessão ausente | Se `startSession()` lançar erro antes de adicionar ao Map, o stream SSE abre mas nunca recebe QR. Workaround: chamar `POST /channels/:id/reconnect` antes de abrir o stream. | Fase 5/6 — melhorar resiliência do startup de sessão |
| `buildEntityOrgFilter` com cast `as object` | Em `channels.ts` e `notifications.ts`, o retorno de `buildEntityOrgFilter` é passado como `...(filter as object)` — escapa a checagem de tipo do Prisma. Se a assinatura do filtro mudar silenciosamente, queries podem omitir o escopo de organização sem erro de compilação. | Fase 6 — tipar corretamente o retorno de `buildEntityOrgFilter` com o tipo `Prisma.XxxWhereInput` adequado |
| `daily-reset-sent-today` usa cron UTC | O job reseta `sent_today` à meia-noite UTC (cron `0 0 * * *`). Para operações no fuso Brasil (UTC-3 a UTC-5), o reset ocorre entre 20h-21h do dia anterior. Impacto: rate limiting diário pode permitir até ≈8h extras de envio antes do reset | Fase 5 — permitir configuração do fuso via `DAILY_RESET_TZ` env var |
| `POST /v1/notifications/send` usa JWT | API externa deveria usar `X-Api-Key` por organização | Fase 5 — implementar middleware de API Key, tabela `api_key` no model `Organization`, manter JWT como fallback |
| `scheduledAt` sem processamento | `notification.scheduledAt` existe no schema mas não há rota nem worker que crie delayed jobs a partir dele | Fase 5 — `POST /v1/notifications/schedule` com `notificationQueue.add(..., { delay })` |
| Janela `sentToday` vs `sentLastHour` pós-reset | Após o reset (sentToday=0), `sentLastHour` ainda conta entregas da última hora — canal pode enviar além do `hourlyLimit` por ≈60 min logo após o reset | Monitorar em Fase 5; mitigação: rate limit horário é a proteção real |
| **Broadcast WhatsApp bloqueado** (decisão de design) | `POST /notifications/broadcast` retorna 400 para WHATSAPP — model `User` não tem campo `phone`. Decisão consciente: broadcast WA requer lista externa de destinatários, não usuários do sistema. | Fase 6+ — adicionar campo `phone` em User se broadcast WA for necessário |
| **API Key em texto puro** | `organization.apiKey` armazenado sem hash. Se o banco vazar, todas as chaves ficam expostas. | Antes de produção — migrar para `SHA-256(apiKey)` no campo e verificar por hash; retornar a chave plain text apenas na geração |
| **Cancelamento de notificação agendada** | Não há `DELETE /notifications/:id`. A chave `bullJobId` agora está disponível no model — o endpoint pode chamar `notificationQueue.remove(bullJobId)` + setar `status: CANCELADO` | Fase 6 — `POST /v1/notifications/:id/cancel` (só para AGENDADO) |
| **Warmup promotion sem evento SSE** | O cron `daily-warmup-promote` promove WARMING→ACTIVE mas não emite evento SSE. O dashboard verá a mudança apenas no próximo polling. | Workaround no dashboard da Fase 6: polling de 60s em `GET /channels?type=WHATSAPP` |
