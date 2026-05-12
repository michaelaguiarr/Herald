# PRD — Herald

**Serviço de Notificações Multi-Canal**
**Versão 6.0 — Final**

---

## Visão Geral

Microserviço de entrega de notificações multi-canal (WhatsApp, Email, Telegram) com hierarquia organizacional de três níveis: Plataforma (OWNER), Paróquias e Comunidades. O serviço é responsável por **receber, enfileirar, entregar mensagens e alertar administradores sobre eventos críticos**. O conteúdo das mensagens chega 100% pronto da API externa.

---

## Responsabilidade do Serviço

| Responsabilidade                                | Deste serviço | De outro serviço |
| ----------------------------------------------- | ------------- | ---------------- |
| Receber mensagem pronta e enfileirar            | ✅            |                  |
| Entregar via WhatsApp, Email, Telegram          | ✅            |                  |
| Onboarding de número WhatsApp via QR Code       | ✅            |                  |
| Rotacionar canais e retry automático            | ✅            |                  |
| Reenvio manual via dashboard                    | ✅            |                  |
| Alertas de eventos críticos via Telegram        | ✅            |                  |
| Controle de usuários e perfis                   | ✅            |                  |
| Autenticação JWT                                | ✅            |                  |
| Auditoria de ações dos usuários                 | ✅            |                  |
| Monitoramento de envios                         | ✅            |                  |
| Composição do texto da mensagem                 |               | ✅ API externa   |
| Cadastro de dizimistas                          |               | ✅ API externa   |
| Regras de negócio (aniversário, pagamento etc.) |               | ✅ API externa   |

---

## Hierarquia Completa

```
OWNER (plataforma)
  ├── Dashboard consolidado de todas as paróquias
  ├── Gerencia paróquias e SUPER_ADMINs
  └── Paróquias (N)
        ├── SUPER_ADMIN
        ├── Dashboard consolidado da paróquia
        ├── Canais próprios
        └── Comunidades (N)
              ├── ADMIN
              ├── OPERATOR
              ├── Dashboard isolado
              └── Canais próprios (WhatsApp pool, Email, Telegram)
```

---

## Perfis de Usuário

| Perfil        | Escopo     | Permissões                                                                                                       |
| ------------- | ---------- | ---------------------------------------------------------------------------------------------------------------- |
| `OWNER`       | Plataforma | Cadastra paróquias e comunidades. Cria SUPER_ADMINs. Dashboard consolidado de tudo. Pode ter múltiplos usuários. |
| `SUPER_ADMIN` | Paróquia   | Gerencia comunidades, canais e usuários da paróquia. Dashboard da paróquia. Reseta senhas.                       |
| `ADMIN`       | Comunidade | Gerencia canais e usuários da comunidade. Dashboard isolado. Reenvia falhas. Reseta senhas.                      |
| `OPERATOR`    | Comunidade | Visualiza dashboard. Aciona reenvio manual. Sem acesso a configurações.                                          |

**Hierarquia de criação:**

```
OWNER       → cria OWNER, SUPER_ADMIN (qualquer paróquia)
SUPER_ADMIN → cria ADMIN (própria paróquia)
ADMIN       → cria OPERATOR (própria comunidade)
Sem auto-cadastro público
```

**Visibilidade de dados:**

| Perfil        | Notificações           | Canais                 | Audit log          |
| ------------- | ---------------------- | ---------------------- | ------------------ |
| `OWNER`       | Todas as organizações  | Todas                  | Toda a plataforma  |
| `SUPER_ADMIN` | Paróquia + comunidades | Paróquia + comunidades | Própria paróquia   |
| `ADMIN`       | Própria comunidade     | Própria comunidade     | Própria comunidade |
| `OPERATOR`    | Própria comunidade     | Não acessa             | Não acessa         |

---

## Onboarding de Número WhatsApp (QR Code)

Ao cadastrar um canal WhatsApp, o ADMIN passa pelo fluxo de conexão via QR Code:

```
ADMIN cadastra novo número WhatsApp
    │
    ▼
Sistema solicita sessão ao Baileys
    │
    ▼
Dashboard exibe QR Code em tela (atualiza a cada 30s se não escaneado)
    │
    ▼
ADMIN escaneia com o celular (WhatsApp → Dispositivos Conectados)
    │
    ▼
Baileys confirma sessão ativa
    │
    ▼
Status do canal → WARMING (aquecimento 7 dias)
    │
    ▼
Após 7 dias → ACTIVE
```

**Gestão de sessão no dashboard:**

- Lista de todos os canais WhatsApp com status em tempo real
- Status possíveis: `WARMING`, `ACTIVE`, `DISCONNECTED`, `BANNED`
- Botão "Reconectar" para sessões `DISCONNECTED` (exibe novo QR Code)
- Sessões persistidas em volume Docker no disco da VPS (sem conflito de instâncias)

---

## Sistema de Alertas (Telegram)

Alertas automáticos enviados via Telegram para todos os usuários da organização que tiverem `telegram_id` cadastrado no perfil.

**Eventos que geram alerta:**

| Evento                          | Severidade | Mensagem exemplo                                                             |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------- |
| Notificação `FALHOU_DEFINITIVO` | 🔴 Crítico | `Falha definitiva: mensagem para João Silva não foi entregue após 3 ciclos.` |
| Número WhatsApp banido          | 🔴 Crítico | `Número +5595991234567 foi banido e desativado automaticamente.`             |
| Sessão WhatsApp caída           | 🟡 Aviso   | `Sessão do número +5595991234567 foi desconectada. Reconexão necessária.`    |

**Regra de destinatários:** alerta é enviado a todos os usuários da organização dona do canal/notificação que tiverem `telegram_id` preenchido no perfil. Se nenhum usuário tiver Telegram cadastrado, o alerta é registrado apenas no `audit_log`.

---

## Fluxo de Entrega e Retry

```
API Externa → POST /v1/notifications/send
    │
    ▼
Fila BullMQ
    │
    ▼
Worker: tenta canal/número 1
    ├── Sucesso → ENVIADO ✅
    └── Falha → próximo número do pool
                    └── Esgotou pool → retry automático
                                          Ciclo 1: +1h
                                          Ciclo 2: +6h
                                          Ciclo 3: +24h
                                              └── Ainda falhou → FALHOU_DEFINITIVO
                                                                  → alerta Telegram
                                                                  → visível no dashboard
                                                                  → operador aciona reenvio
```

---

## Anti-Banimento WhatsApp

- Rate limiting por número: limites diário e por hora configuráveis
- Intervalo mínimo entre envios: 2 a 5 segundos por número
- Rotação automática entre números do pool ao atingir limite
- Aquecimento de número novo: volume crescente nos primeiros 7 dias (`WARMING`)
- Detecção de banimento com desativação automática e alerta Telegram
- Bloqueio de envio para o mesmo destinatário por números diferentes no mesmo dia

---

## Modelo de Dados Completo

```
organization
  id            UUID PK
  name          VARCHAR
  type          ENUM(PAROQUIA, COMUNIDADE)
  parent_id     UUID FK → organization NULL
  active        BOOLEAN DEFAULT true
  created_at    TIMESTAMP

user
  id              UUID PK
  organization_id UUID FK → organization NULL  -- NULL para OWNER
  name            VARCHAR
  email           VARCHAR UNIQUE
  password_hash   VARCHAR
  role            ENUM(OWNER, SUPER_ADMIN, ADMIN, OPERATOR)
  telegram_id     VARCHAR NULL  -- para receber alertas críticos
  active          BOOLEAN DEFAULT true
  reset_token     VARCHAR NULL
  reset_token_exp TIMESTAMP NULL
  last_login_at   TIMESTAMP NULL
  created_at      TIMESTAMP

channel
  id              UUID PK
  organization_id UUID FK → organization
  type            ENUM(WHATSAPP, EMAIL, TELEGRAM)
  label           VARCHAR
  credentials     JSONB (criptografado em repouso — AES-256)
  status          ENUM(ACTIVE, INACTIVE, BANNED, WARMING, DISCONNECTED)
  daily_limit     INT
  hourly_limit    INT
  sent_today      INT DEFAULT 0
  last_used_at    TIMESTAMP NULL
  created_at      TIMESTAMP

notification
  id                    UUID PK
  organization_id       UUID FK → organization
  channel_type          ENUM(WHATSAPP, EMAIL, TELEGRAM)
  recipient_name        VARCHAR
  recipient_phone       VARCHAR NULL
  recipient_email       VARCHAR NULL
  recipient_telegram_id VARCHAR NULL
  message               TEXT
  status                ENUM(PENDENTE, ENVIADO, FALHOU, FALHOU_DEFINITIVO, AGENDADO, CANCELADO)
  scheduled_at          TIMESTAMP NULL
  sent_at               TIMESTAMP NULL
  retry_cycle           INT DEFAULT 0
  created_at            TIMESTAMP

notification_attempt
  id              UUID PK
  notification_id UUID FK → notification
  channel_id      UUID FK → channel
  attempted_at    TIMESTAMP
  success         BOOLEAN
  error_message   VARCHAR NULL

audit_log
  id              UUID PK
  user_id         UUID FK → user
  organization_id UUID FK → organization NULL
  action          VARCHAR
  target_id       UUID NULL
  target_type     VARCHAR NULL
  metadata        JSONB NULL
  ip_address      VARCHAR NULL
  created_at      TIMESTAMP
```

---

## Endpoints

### Autenticação

```http
POST /v1/auth/login
POST /v1/auth/forgot-password
POST /v1/auth/reset-password
```

### Plataforma (OWNER)

```http
POST   /v1/organizations
GET    /v1/organizations
PUT    /v1/organizations/{id}
DELETE /v1/organizations/{id}
```

### Usuários

```http
GET    /v1/users
POST   /v1/users
PUT    /v1/users/{id}
DELETE /v1/users/{id}
POST   /v1/users/{id}/reset-password
```

### Canais

```http
POST   /v1/channels
GET    /v1/channels
PUT    /v1/channels/{id}
DELETE /v1/channels/{id}
GET    /v1/channels/{id}/qrcode      -- gera QR Code para onboarding WhatsApp
GET    /v1/channels/{id}/status      -- status em tempo real da sessão
POST   /v1/channels/{id}/reconnect   -- reconecta sessão DISCONNECTED
```

### Notificações (chamadas pela API externa)

```http
POST /v1/notifications/send
POST /v1/notifications/schedule
POST /v1/notifications/broadcast
GET  /v1/notifications
GET  /v1/notifications/{id}
POST /v1/notifications/{id}/retry
```

### Dashboard e Auditoria

```http
GET /v1/dashboard/summary
GET /v1/dashboard/pending
GET /v1/dashboard/failed
GET /v1/audit-logs
```

---

## Infraestrutura

**Ambiente:** VPS própria com Docker Compose.

```yaml
# docker-compose.yml (estrutura)
services:
  api:
    build: .
    ports: ["3000:3000"]
    volumes:
      - ./whatsapp-sessions:/app/sessions # sessões Baileys persistidas
    depends_on: [postgres, redis]

  postgres:
    image: postgres:16
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

  frontend:
    build: ./dashboard
    ports: ["80:80"]

volumes:
  postgres_data:
  redis_data:
```

**Sessões Baileys:** persistidas em volume Docker (`./whatsapp-sessions`). Como o ambiente é single-instance (docker-compose na VPS), não há conflito de sessão entre instâncias.

---

## Segurança

- JWT com expiração de 8h
- Senhas com bcrypt (salt rounds: 12)
- Credentials de canais criptografadas com AES-256
- Isolamento por `organizationId` em todas as queries (exceto OWNER)
- Rate limiting na API de entrada
- Token de reset com expiração de 1 hora e uso único
- API Key por organização para chamadas da API externa (`X-Api-Key`)

---

## Stack Sugerida

| Camada         | Tecnologia            |
| -------------- | --------------------- |
| Runtime        | Node.js               |
| Framework      | Fastify               |
| Autenticação   | JWT + bcrypt          |
| WhatsApp       | Baileys               |
| Email          | Nodemailer            |
| Telegram       | node-telegram-bot-api |
| Fila e retry   | BullMQ + Redis        |
| Banco de dados | PostgreSQL            |
| ORM            | Prisma                |
| Criptografia   | Node crypto (AES-256) |
| Dashboard      | React + Recharts      |
| Infra          | Docker Compose        |

---

## Fases de Desenvolvimento

### Fase 1 — Core e Autenticação

- Setup completo com Docker Compose (API + PostgreSQL + Redis)
- Modelo de dados com migrations Prisma
- Autenticação JWT com os quatro perfis
- CRUD de organizações (OWNER)
- CRUD de usuários com hierarquia
- Recuperação de senha por email
- `POST /v1/notifications/send` com canal Email
- Fila BullMQ com worker de entrega
- Registro de tentativas em `notification_attempt`

### Fase 2 — WhatsApp e Telegram

- Integração Baileys com sessão persistida em volume Docker
- Fluxo de QR Code para onboarding de número novo
- Reconexão automática de sessão caída
- Integração Telegram Bot API
- CRUD de canais com criptografia AES-256
- Rotação de pool em caso de falha

### Fase 3 — Anti-Banimento, Retry e Alertas

- Rate limiting e rotação WhatsApp
- Aquecimento de número novo (7 dias)
- Detecção de banimento com desativação automática
- Retry automático em 3 ciclos (1h, 6h, 24h)
- Status `FALHOU_DEFINITIVO` e endpoint de reenvio manual
- Sistema de alertas Telegram para eventos críticos

### Fase 4 — Agendamento, Hierarquia e Broadcast

- `POST /v1/notifications/schedule` com BullMQ delayed jobs
- `POST /v1/notifications/broadcast` para toda a paróquia
- Isolamento e visibilidade de dados por perfil

### Fase 5 — Dashboard e Auditoria

- API de métricas filtrada por escopo do perfil
- Registro de `audit_log` em todas as ações relevantes
- Frontend React com Recharts
- Painel de sessões WhatsApp com QR Code e status em tempo real
- Fila de `FALHOU_DEFINITIVO` para reenvio manual

---

## Critérios de Aceite (MVP)

**Plataforma e Usuários**

- [ ] OWNER cadastra paróquias e comunidades
- [ ] OWNER cria SUPER_ADMIN para cada paróquia
- [ ] SUPER_ADMIN cria ADMIN para comunidades
- [ ] ADMIN cria OPERATOR da própria comunidade
- [ ] Login retorna JWT com perfil e escopo corretos
- [ ] Recuperação de senha por email com token de 1 hora
- [ ] Reset manual de senha por admin/SUPER_ADMIN/OWNER
- [ ] Dados isolados por organização conforme perfil

**WhatsApp Onboarding**

- [ ] Dashboard exibe QR Code para novo número
- [ ] QR Code atualiza a cada 30s se não escaneado
- [ ] Após scan, sessão criada e status vai para WARMING
- [ ] Após 7 dias de aquecimento, status vai para ACTIVE
- [ ] Botão "Reconectar" exibe novo QR Code para sessão DISCONNECTED
- [ ] Sessões persistidas em volume Docker

**Notificações**

- [ ] Receber mensagem pronta e enfileirar
- [ ] Entregar via WhatsApp com rotação de pool em falha
- [ ] Entregar via Email
- [ ] Entregar via Telegram
- [ ] Retry automático em 3 ciclos após esgotar pool
- [ ] Status `FALHOU_DEFINITIVO` após 3 ciclos
- [ ] Reenvio manual via endpoint autenticado
- [ ] Agendamento para data/hora futura
- [ ] Broadcast para todas as comunidades da paróquia

**Alertas**

- [ ] Alerta Telegram enviado em falha definitiva
- [ ] Alerta Telegram enviado em banimento de número
- [ ] Alerta Telegram enviado em sessão desconectada
- [ ] Alerta enviado apenas para usuários com `telegram_id` cadastrado
- [ ] Evento registrado em `audit_log` mesmo sem Telegram cadastrado

**Canais e Segurança**

- [ ] Credentials armazenadas criptografadas (AES-256)
- [ ] Rate limiting por número WhatsApp
- [ ] Banimento detectado e número desativado automaticamente

**Dashboard e Auditoria**

- [ ] OWNER vê dashboard consolidado de todas as paróquias
- [ ] SUPER_ADMIN vê paróquia e comunidades
- [ ] ADMIN e OPERATOR veem apenas a própria comunidade
- [ ] Lista de `FALHOU_DEFINITIVO` disponível para reenvio
- [ ] Toda ação relevante registrada em `audit_log`
- [ ] API documentada (Swagger/OpenAPI)
