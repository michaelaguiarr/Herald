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
| **Baileys v7 + Node.js v26 incompatibilidade** | `whatsapp-rust-bridge` só exporta condição `"import"` (ESM); Node.js v26 + tsx CJS register lança `ERR_PACKAGE_PATH_NOT_EXPORTED` | Patch `patches/whatsapp-rust-bridge+0.5.4.patch` adiciona `"default": "./dist/index.js"`; `patch-package` aplica automaticamente no `postinstall`; `tsconfig.json` migrado para `NodeNext`. **O nome do arquivo carrega a versão** — ao subir o Baileys, conferir se a dependência mudou de versão e regerar o patch, senão ele é silenciosamente ignorado |
| **`result.status` ignorado no envio** | `socket.sendMessage()` retornava sem exceção mesmo quando WA server rejeitava (`status=0 ERROR`) ou quando Baileys não gerava ID de mensagem — worker marcava ENVIADO incondicionalmente | Verificações adicionadas: `!result?.key?.id` → lança erro; `result.status === 0` → lança erro com mensagem explícita |
| **`onWhatsApp` bypassado silenciosamente** | Bloco try/catch engolia qualquer exceção de `onWhatsApp` que não fosse exatamente "não encontrado" — número inválido ou erros de sessão faziam o envio prosseguir sem verificação | Erro "não encontrado" re-lançado; demais erros logam `raw=` e `resolved=` para diagnóstico; envio prossegue mas com aviso explícito no log |
| **Retry bloqueado para status ENVIADO** | Endpoint `/retry` só aceitava `FALHOU` ou `FALHOU_DEFINITIVO`; após ENVIADO sem entrega real o operador não conseguia reenviar | `ENVIADO` adicionado à lista de statuses retentáveis — ENVIADO confirma apenas que Baileys não lançou exceção, não que o destinatário recebeu |

---

## Bug Fixes Pós-Fase 5 (Regressão WhatsApp)

Regressão introduzida em `2587674` (Fase 5): notificações voltaram a ser marcadas ENVIADO sem entrega real. Três correções aplicadas.

| Bug | Commit introdutor | Causa | Correção aplicada |
| --- | ----------------- | ----- | ----------------- |
| **`onWhatsApp` fallthrough para JID raw** | `2587674` | catch do `onWhatsApp` relançava apenas "não encontrado"; qualquer outro erro (timeout, sessão instável) fazia fallthrough com JID raw — Baileys retornava `key.id + status≥1` para JID errado, marcando ENVIADO sem entrega | `baileys.client.ts`: **todo** erro de `onWhatsApp` agora é relançado. JID sem resolução LID nunca chega ao `sendMessage`. Worker captura a exceção, registra attempt `success=false` e agenda retry. |
| **Guard `check?.exists === false` não capturava array vazio** | — (pós-Fase 5) | Baileys v7 retorna `[]` (array vazio) para números inexistentes — não `{ exists: false }`. Strict equality `undefined === false → false` deixava o guard passar silenciosamente. `resolvedJid` ficava como JID raw, Baileys aceitava com SERVER_ACK, notificação marcada ENVIADO. | `baileys.client.ts` linha 182: guard alterado para `!check \|\| check.exists === false`. `!check` captura array vazio (`check = undefined`); `check.exists === false` captura a forma explícita. Cache só é escrito quando o guard passa e `check.exists && check.jid` são verdadeiros — número inválido nunca é cacheado. |
| **Desconexão controlada de sessão WhatsApp** | — | Faltava endpoint para encerrar intencionalmente uma sessão sem gerar novo QR Code automaticamente. Útil para troca de número ou encerramento definitivo. | `POST /v1/channels/:id/disconnect`: chama `whatsappSessionManager.disconnectSession(id)` que para a sessão Baileys (`_manualDisconnect=true`, `_shouldReconnect=false`), remove os arquivos de auth, atualiza DB para DISCONNECTED e grava `CHANNEL_DISCONNECTED` no audit_log. Diferença vs `/reconnect`: disconnect encerra sem iniciar nova sessão; reconnect encerra + gera QR. `_manualDisconnect` flag no BaileysClient sinaliza que a desconexão foi intencional — cancela timer de alerta e suprime reconexão. |
| **Reconexão com backoff exponencial** | — | `BaileysClient` reconectava em 5s fixos. Com múltiplos canais caindo simultaneamente (queda de rede, restart), todos tentavam reconectar no mesmo segundo — thundering herd que sobrecarrega o WA. | `src/lib/backoff.ts`: `calculateBackoff(attempt, { baseMs=2000, maxMs=60000, jitterMs=1000 })` — fórmula `min(base * 2^attempt, max) + random(0, jitter)`. `_reconnectAttempt` incrementa a cada desconexão, reseta a 0 em `connection=open`. BANNED não reconecta. Log: `[wa:reconnect] channelId tentativa=N delay=Xms próxima=HH:MM:SS` |
| **Opt-out por resposta WhatsApp** | — | Destinatários que respondem "PARAR", "STOP", "CANCELAR", "SAIR", "REMOVER" ou "DESCADASTRAR" para o número do Herald são automaticamente registrados em `opt_out` e deixam de receber notificações. `OptOutError` é terminal (sem retry). Admin pode reativar via `DELETE /v1/opt-outs/:phone`. | `src/channels/whatsapp/whatsapp-errors.ts`: `OptOutError`. `baileys.client.ts`: listener `messages.upsert`, emite `'opt-out-request'`. `session.manager.ts`: upsert em `opt_out`, invalida cache JID, envia confirmação via `sendDirectMessage`. `channel-selector.ts`: verifica `opt_out` antes de selecionar canais, lança `OptOutError`. `notification.worker.ts`: `OptOutError` → `FALHOU_DEFINITIVO` sem throw → sem retry. `opt-outs.ts`: `GET /v1/opt-outs` (lista paginada) + `DELETE /v1/opt-outs/:phone` (reativação). |
| **Número inexistente entrava no ciclo de retry** | — (pós-Fase 5) | `WhatsAppNumberNotFoundError` era capturado e re-embalado como `Error` genérico, tratado como erro transiente. BullMQ agendava retries (+1h/+6h/+24h) para um número que nunca vai existir. | `WhatsAppNumberNotFoundError` em `src/channels/whatsapp/whatsapp-errors.ts`. `baileys.client.ts` catch re-lança o tipo original sem embrulhar. `notification.worker.ts` detecta `instanceof WhatsAppNumberNotFoundError` no loop de pool rotation → marca `FALHOU_DEFINITIVO` imediatamente + `return` sem `throw` (BullMQ não agenda retry). Outros erros mantêm comportamento de retry. |
| **Async gap no handler de warmup** | `2587674` | Fase 5 adicionou lógica de warmup com query DB assíncrona dentro do handler de `status-change`. Entre `setStatus('ACTIVE')` (síncrono, memória) e o `prisma.channel.update` (assíncrono, DB), o canal aparecia como ACTIVE no banco. Worker podia selecionar o canal e chamar `sendMessage` durante essa janela com sessão instável. | `session.manager.ts`: query `findUnique` movida para **antes** do listener. Flag `firstConnectionRecorded` (mutable) flippada **sincronicamente** antes de qualquer `await`, eliminando o gap. Log do erro de update melhorado — não silencia falhas críticas de estado. |
| **Canal WARMING/ACTIVE sem `connectedAt` elegível** | `2587674` | `channel-selector.ts` incluiu canais WARMING com `connectedAt ≠ null` mas não protegia canais ACTIVE com `connectedAt=null` (status padrão ao criar canal). Canal criado mas nunca autenticado (QR não escaneado) podia ser selecionado quando DB mostrava ACTIVE. | `channel-selector.ts`: para `channelType === WHATSAPP`, filtro pós-query em JavaScript: `candidates.filter(ch => ch.connectedAt !== null)`. Canal sem `connectedAt` nunca chega ao dispatch, independente do status DB. Email/Telegram não são afetados (não usam `connectedAt`). |
| **Race condition residual no `/reconnect`** | `2587674` | Endpoint `/reconnect` setava DB para `WARMING` imediatamente. `selectChannels` via Fix 3 permitia WARMING + connectedAt set. Novo `BaileysClient` criado por `startSession` tem `_status='WARMING'` (construtor). Dispatch durante os segundos entre reconnect e QR-scan resultava em `success=false` com "Sessão não está ativa (status: WARMING)" — attempt desnecessário, notificação ficava PENDENTE. | `channels.ts` `/reconnect`: status setado para `DISCONNECTED` (não `WARMING`). DISCONNECTED é excluído pelo selector → zero attempts durante reconexão. `WARMING` agora é setado exclusivamente pelo `session.manager` quando Baileys dispara `connection.open`. `connectedAt` preservado intacto (histórico de warmup). |
| **`connectedAt` ausente no response da API** | — | `channelShape` em `channels.ts` não incluía `connectedAt`. Campo estava no banco mas omitido na serialização Zod/Fastify. Operadores não conseguiam distinguir "canal conectado há X dias" de "canal nunca autenticado" — gerou falso positivo de diagnóstico. | `connectedAt: z.date().nullable()` adicionado ao `channelShape`. Agora visível em `GET /v1/channels` e `GET /v1/channels/:id`. |
| **Timer de reconexão órfão destruía pareamentos** | — | `setTimeout` do auto-reconnect não guardava o handle, e `_shouldReconnect` era lido **só ao agendar**. Um timer em voo sempre disparava — inclusive depois de `disconnect()` — ressuscitando o cliente morto, que reabria socket sobre o **mesmo diretório de auth** do cliente substituto. Duas sockets na mesma credencial = `Stream Errored (conflict)` → 401, matando a sessão segundos após parear. Invisível enquanto o 405 impedia qualquer pareamento. | `_reconnectTimer` guarda o handle; `clearReconnectTimer()` em `connect()`, `disconnect()`, 403 e 401. Contador `_epoch` incrementado em `connect()`/`disconnect()` é capturado no agendamento e reconferido **no disparo** — timer de cliente superado aborta. `scheduleReconnect()` centraliza o agendamento. |
| **`restartRequired` (515) tratado como falha** | — | 515 é o close **obrigatório e normal** logo após um pareamento bem-sucedido: o Baileys exige reconexão imediata para concluir. Caía no caminho `DISCONNECTED` + backoff, e quando havia qualquer gate no meio (ex: flag de diagnóstico) o pareamento era simplesmente descartado — QR escaneado, `creds.update` gravado, e sessão perdida. | Ramo próprio **antes** de qualquer gate: reconecta em 500 ms, não incrementa `_reconnectAttempt` e não emite `DISCONNECTED` (evita flap de status no banco e no SSE). `MAX_CONSECUTIVE_RESTARTS=5` evita giro infinito; `_restartRequiredCount` zera em `connection.open`. |
| **`loggedOut` (401) reconectava para sempre com credencial morta** | — | 401 ocorre quando o dispositivo é desvinculado **ou** quando outra conexão assume o slot (`conflict`). Nos dois casos a credencial salva está morta, mas o código tratava como queda comum e reagendava — gerando loop infinito de `Connection Failure` com `credsUpdates=0`, sem nunca limpar a auth nem emitir QR novo. | 401 virou estado terminal: `_shouldReconnect=false`, timer cancelado, `clearAuthState()` apaga a auth para o próximo start gerar QR novo, e status vai para `DISCONNECTED` (o alerta `SESSAO_DESCONECTADA` de 2 min cobre a notificação). |

---

## Incidente: 405 Connection Failure — versão de protocolo defasada

**Sintoma:** todas as sessões WhatsApp param de conectar. QR Code nunca é emitido
(frontend fica em "Gerando QR Code..." infinito). Loop de reconexão acumula
dezenas de milhares de tentativas. Afeta inclusive canais recém-criados que
nunca parearam — sinal de que **não** é credencial, sessão nem canal específico.

**Causa:** o Baileys v7 hardcoda a versão do protocolo WhatsApp em
`DEFAULT_CONNECTION_CONFIG` (`fetchLatestBaileysVersion()` foi removida na v7).
Quando o WhatsApp corta a versão no servidor, todo `connect` é recusado no
handshake com `405 Method Not Allowed / Connection Failure`.

**Diagnóstico — como confirmar:**

```
[wa:close] <id> statusCode=405 reason=desconhecido(405) qrEmitidos=0 credsUpdates=0
           erro=Error: Connection Failure
           payload={"statusCode":405,"error":"Method Not Allowed",...}
```

`qrEmitidos=0` + `credsUpdates=0` provam que a conexão morre **antes** do
handshake produzir qualquer coisa. 405 não faz parte do enum `DisconnectReason`
do Baileys justamente porque não é um disconnect de sessão.

Comparar a versão hardcoded instalada com a da última release:

```bash
grep "const version" node_modules/@whiskeysockets/baileys/lib/Defaults/index.js
npm view @whiskeysockets/baileys version
```

**Não confundir com rate limit de IP.** Um canal novo, sem credenciais, tomando
405 na primeiríssima tentativa descarta rate limit — assim como o fato de não
haver recuperação espontânea após dias. Para isolar, rodar um teste de conexão
com a versão nova a partir do IP de produção antes de deployar.

**Correção:** subir o Baileys para a release que contém o bump de versão.

| Data | Versão Baileys | Versão WA hardcoded |
|---|---|---|
| corte em 2026-07-29 | `7.0.0-rc10` | `[2, 3000, 1035194821]` |
| correção | `7.0.0-rc14` | `[2, 3000, 1043857760]` |

Ao subir, conferir também `whatsapp-rust-bridge` (patch versionado por nome de
arquivo) e `libsignal` (saiu de dependência git para `^6.0.0` no registry npm).

**Mitigação durante a investigação:** `WA_AUTORECONNECT_DISABLED_CHANNELS`
(lista de IDs separados por vírgula) impede o agendamento de reconexão
automática por canal, sem derrubar o reconnect manual. Evita que o loop sem
teto queime milhares de tentativas enquanto se diagnostica.

## Suporte a imagens em notificações

Notificações podem incluir imagem com legenda nos três canais.

### Campos novos em `Notification`

| Campo | Tipo | Descrição |
|---|---|---|
| `imageUrl` | `String?` | URL pública da imagem |
| `imageCaption` | `String?` | Legenda exibida abaixo da imagem |

### Comportamento por canal

| Canal | Comportamento |
|---|---|
| **WhatsApp** | Baixa a imagem (buffer, 10s timeout) e envia via Baileys `{ image: Buffer, caption }` |
| **Email** | Insere `<img src="imageUrl">` inline no HTML. URL acessada pelo cliente de email |
| **Telegram** | Usa `bot.sendPhoto(chatId, imageUrl, { caption })` — Telegram baixa server-side |

### Validações

- `imageUrl` deve ser URL válida (`z.string().url()`)
- `message` ou `imageUrl` — pelo menos um obrigatório
- `message` pode ser omitido quando `imageUrl` está presente (`message` fica `""` no banco)
- URL com timeout de download (10s) para WhatsApp — falha com mensagem clara

### Limitações

- `imageUrl` deve ser **publicamente acessível** sem autenticação
- WhatsApp: download no servidor no momento do envio — URL deve existir durante a janela de retry
- Tamanho máximo recomendado: <5MB (limite do WA)

---

## Read Receipts WhatsApp (Delivery ACK)

Implementado tracking de entrega de ponta a ponta para notificações WhatsApp.

### Modelo de dados

`NotificationAttempt` ganhou dois campos opcionais (nullable para retrocompatibilidade):

| Campo | Tipo | Descrição |
|---|---|---|
| `whatsappMessageId` | `String?` | `key.id` retornado pelo Baileys no envio |
| `deliveryStatus` | `String?` | `SERVER_ACK` → `DELIVERY_ACK` → `READ` |

### Fluxo

```
sendMessage() → key.id → attempt.whatsappMessageId = key.id
                          attempt.deliveryStatus   = 'SERVER_ACK'

WA server → Baileys messages.update event
  → BaileysClient emite 'delivery-update' { messageId, status }
  → session.manager ouve, busca attempt por whatsappMessageId
  → atualiza deliveryStatus (rank-guarded: nunca regride)
```

### Status possíveis em `deliveryStatus`

| Valor | Significado |
|---|---|
| `SERVER_ACK` | WA server recebeu a mensagem |
| `DELIVERY_ACK` | Dispositivo do destinatário recebeu |
| `READ` | Destinatário abriu o chat |

### Rank-guard

O listener em `session.manager.ts` só avança o status, nunca retrocede. Rank interno: `SERVER_ACK=1 < DELIVERY_ACK=2 < READ=3`. Updates fora de ordem (possíveis em reconexões) são descartados silenciosamente.

### Retrocompatibilidade

Attempts criados antes dessa feature têm `whatsappMessageId=null` e `deliveryStatus=null`. Isso é esperado — campos opcionais, sem breaking change no schema.

### Observação sobre PENDING

O evento `messages.update` com `status=1` (PENDING) é ignorado — é estado local do Baileys, não indica confirmação do servidor. Tracking começa a partir de `status=2` (SERVER_ACK).

---

## GET /v1/dashboard/failed — categorização de falhas

### failureReason — lógica de classificação (em ordem de prioridade)

| Categoria | Critério |
|---|---|
| `OPT_OUT` | `recipientPhone` existe em `opt_out` para a mesma `organizationId` |
| `NO_CHANNEL` | `attempts.length === 0` e não é OPT_OUT (sem canal elegível no momento da falha) |
| `NUMBER_NOT_FOUND` | Último attempt tem `errorMessage` contendo `"não encontrado no WhatsApp"` |
| `DELIVERY_FAILURE` | Esgotou ciclos de retry por erro de conexão/entrega (fallback) |

### Campos adicionados ao response

```json
{
  "summary": {
    "OPT_OUT": 2,
    "NUMBER_NOT_FOUND": 3,
    "DELIVERY_FAILURE": 4,
    "NO_CHANNEL": 1
  },
  "data": [
    {
      "...campos existentes...",
      "failureReason": "NUMBER_NOT_FOUND",
      "attempts": [{ "id", "channelId", "success", "errorMessage", "whatsappMessageId", "deliveryStatus" }]
    }
  ],
  "total": 10,
  "page": 1,
  "pages": 1
}
```

### Filtro por categoria

`GET /v1/dashboard/failed?failureReason=OPT_OUT`

Valores: `OPT_OUT | NUMBER_NOT_FOUND | DELIVERY_FAILURE | NO_CHANNEL`

### Implementação

Classificação feita em memória após busca com `include: { attempts }` + batch-load de `opt_out` para as phones do resultado. `summary` calcula a distribuição completa ANTES do filtro por `failureReason` — garante contagens corretas independente do filtro ativo.

---

## Cache de JID WhatsApp

### Objetivo
Evitar a chamada `onWhatsApp()` do Baileys a cada envio. Para destinatários recorrentes (dizimistas, broadcasts), o JID é sempre o mesmo — a chamada repetida só adiciona latência.

### Redis keys

| Chave | Tipo | Descrição |
|---|---|---|
| `whatsapp:jid:{digits}` | `STRING` | JID resolvido, TTL 24h |
| `whatsapp:jid:stats:hits` | `INT` | Contador de cache hits (reset diário) |
| `whatsapp:jid:stats:misses` | `INT` | Contador de cache misses (reset diário) |

### Arquivo
`src/lib/whatsapp-jid.cache.ts` — exports: `getCachedJid`, `setCachedJid`, `invalidateCachedJid`, `getJidCacheStats`, `resetJidCacheStats`

### Fluxo em `BaileysClient.sendMessage`

```
HIT  → [wa:cache] HIT +5595991234567 → 5595991234567@s.whatsapp.net
         usa JID direto, skipa onWhatsApp()

MISS → [wa:cache] MISS +5595991234567 → resolvendo via onWhatsApp()
         chama onWhatsApp(), cacheia resultado, continua envio

ERRO → não cacheia — próximo envio tenta onWhatsApp() novamente
```

### TTL: 24h
Cobre o ciclo de mensagens recorrentes (dizimistas mensais). JIDs são estáveis enquanto o usuário não troca de dispositivo. O pior caso de stale entry é um envio falhando silenciosamente se o usuário migrou de Android para iPhone no dia (raro) — o sistema faz retry no ciclo seguinte que vai recachear o novo JID.

### Métricas
`GET /v1/dashboard/summary` expõe `jidCacheStats: { hits, misses }` diários. Resetado pelo cron `daily-reset-sent-today` junto com `sentToday`.

### Limitação conhecida
O cache pode ficar stale por até 24h se um usuário mudar de dispositivo (troca Android→iPhone causa migração de JID). Neste caso, o primeiro envio pós-migração pode usar o JID antigo. Baileys retornará erro ou SERVER_ACK sem entrega; o worker registra o attempt como falha e o operador pode reenviar, o que vai causar um cache miss (JID antigo foi descartado na falha).

**Invalidação manual**: `invalidateCachedJid(phone)` remove a entrada. Pode ser chamada se necessário (ex: número relatado como não recebendo mensagens).

### Arquivos alterados em Read Receipts

- `prisma/schema.prisma` — 2 campos em `NotificationAttempt`
- `prisma/migrations/20260513042031_add_delivery_status/migration.sql`
- `src/channels/whatsapp/baileys.client.ts` — `sendMessage` retorna `messageId`, listener `messages.update`
- `src/channels/whatsapp/session.manager.ts` — `sendMessage` retorna `messageId`, listener `delivery-update`
- `src/channels/channel.dispatcher.ts` — `dispatch` retorna `DispatchResult { whatsappMessageId? }`
- `src/workers/notification.worker.ts` — captura e salva `whatsappMessageId` + status inicial
- `src/http/routes/notifications.ts` — `attemptShape` expõe os dois novos campos

---

## POST /auth/change-password — alteração de senha pelo próprio usuário

`POST /v1/auth/change-password` — autenticado via JWT (qualquer perfil).

**Body:** `{ currentPassword, newPassword, confirmPassword }`

**Validações (em ordem):**
1. `newPassword !== confirmPassword` → 400 "Nova senha e confirmação não coincidem"
2. `newPassword === currentPassword` → 400 "A nova senha não pode ser igual à senha atual"
3. `currentPassword` não bate com hash → 400 "Senha atual incorreta"
4. `newPassword` mínimo 8 caracteres (Zod)

**Comportamento:**
- Não invalida o token atual — usuário continua logado
- Grava `audit_log` com `action = 'USER_CHANGED_PASSWORD'`
- `passwordHash` atualizado com bcrypt, salt rounds 12

---

## Permissões SUPER_ADMIN em /organizations

### Helper `assertOrgScope` — `src/http/routes/organizations.ts`

Função local que centraliza a verificação de escopo para SUPER_ADMIN:
- `OWNER` → passa sempre (sem restrição)
- `SUPER_ADMIN` → `org.id === actor.organizationId` **ou** `org.parentId === actor.organizationId`; caso contrário lança 403 com a mensagem fornecida

Usada em: PUT, DELETE, POST/DELETE api-key.

### Tabela de permissões por endpoint

| Endpoint | OWNER | SUPER_ADMIN | Restrição SUPER_ADMIN |
|---|---|---|---|
| `POST /organizations` | ORGANIZACAO ou FILIAL | Apenas FILIAL | `parentId` deve estar no escopo |
| `PUT /organizations/:id` | qualquer | qualquer | org deve estar no escopo |
| `DELETE /organizations/:id` | qualquer | apenas FILIAL | org deve ser FILIAL **e** estar no escopo |
| `POST /organizations/:id/api-key` | qualquer | qualquer | org deve estar no escopo |
| `DELETE /organizations/:id/api-key` | qualquer | qualquer | org deve estar no escopo |

**Escopo SUPER_ADMIN:** `org.id === actor.organizationId` (própria org) ou `org.parentId === actor.organizationId` (filial direta).

**Erros específicos:**
- `DELETE` com SUPER_ADMIN em ORGANIZACAO → 403 `"Apenas o dono do sistema pode desativar uma organização"`
- Qualquer endpoint com org fora do escopo → 403 com mensagem do endpoint

---

## Dívidas Técnicas Documentadas

| Item | Impacto | Resolver na |
| ---- | ------- | ----------- |
| ~~`channel.sentToday` nunca é zerado~~ | ~~Rate limiting bloqueará envios após o 1º dia~~ | ✅ Resolvido — cron `daily-reset-sent-today` em `scheduler.worker.ts` |
| ~~`notificationQueue` com `attempts: 1`~~ | ~~Retry ciclos precisam de `attempts: 4` + backoff~~ | ✅ Resolvido — pré-Fase 4 |
| ~~`POST /v1/notifications/send` usa JWT~~ | ~~API externa deveria usar `X-Api-Key`~~ | ✅ Resolvido — `authenticate-api-key.ts` + campo `apiKey` em `Organization` |
| ~~`scheduledAt` sem processamento~~ | ~~Sem rota nem worker para delayed jobs~~ | ✅ Resolvido — `POST /v1/notifications/schedule` em `notifications.ts` |
| ~~`buildEntityOrgFilter` com cast `as object`~~ | ~~Escapa checagem de tipo do Prisma~~ | ✅ Resolvido — `OrgScopeFilter` tipado como `{ organizationId?: string \| { in: string[] } }` em `scope-guard.ts` |
| ~~`daily-reset-sent-today` usa cron UTC~~ | ~~Reset às 20h-21h no Brasil~~ | ✅ Resolvido — env var `DAILY_RESET_TZ` suportada em `env.ts` e `scheduler.worker.ts` |
| ~~**API Key em texto puro**~~ | ~~Banco vazado expõe todas as chaves~~ | ✅ Resolvido — `SHA-256(rawKey)` armazenado; chave plain retornada apenas na geração |
| `notification_attempt` sem canal disponível | Falha por "sem canal" não gera attempt (FK obrigatório) — rastreamento incompleto | Avaliar tornar `channelId` nullable em migração futura |
| SSE `/qrcode` com sessão ausente | Se `startSession()` falhar antes de adicionar ao Map, o stream abre mas nunca recebe QR. Workaround: chamar `POST /channels/:id/reconnect` antes de abrir o stream. | Melhoria futura — resiliência do startup de sessão |
| Janela `sentToday` vs `sentLastHour` pós-reset | Após reset, `sentLastHour` ainda conta envios da última hora — canal pode enviar além do `hourlyLimit` por ≈60 min | Mitigação aceitável: rate limit horário é a proteção real |
| **Broadcast WhatsApp bloqueado** (decisão de design) | `POST /notifications/broadcast` ignora WHATSAPP — model `User` não tem campo `phone`. Broadcast WA requer lista externa de destinatários. | Melhoria futura — adicionar `phone` em `User` se broadcast WA for necessário |
| **Cancelamento de notificação agendada** | Sem `DELETE /notifications/:id`. `bullJobId` disponível no model — pode chamar `notificationQueue.remove(bullJobId)` + `status: CANCELADO` | Melhoria futura — `POST /v1/notifications/:id/cancel` (só para `AGENDADO`) |
| **Warmup promotion sem evento SSE** | Cron `daily-warmup-promote` promove WARMING→ACTIVE mas não emite evento SSE. Dashboard vê a mudança apenas no próximo polling. | Workaround: polling de 60s em `GET /channels?type=WHATSAPP` |
