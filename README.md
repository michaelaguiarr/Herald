# Herald

> *"Herald"* — do inglês antigo, o mensageiro real que anunciava decretos e levava notícias entre reinos. O nome captura a essência do serviço: um intermediário confiável que entrega mensagens com precisão, independente do canal.

Microserviço de entrega de notificações multi-canal para plataformas de gestão organizacional. Recebe mensagens prontas de uma API externa e é responsável por enfileirar, entregar, rotacionar canais, fazer retry automático e alertar administradores sobre eventos críticos.

---

## Canais suportados

| Canal     | Entrega | Status de sessão | Anti-banimento |
| --------- | ------- | ---------------- | -------------- |
| WhatsApp  | ✅      | ✅ QR Code       | ✅ Pool + aquecimento |
| Email     | ✅      | —                | —              |
| Telegram  | ✅      | —                | —              |

---

## Grupos WhatsApp

O Herald suporta envio de notificações para grupos do WhatsApp, além de números individuais.

### Endpoint — listar grupos

```
GET /v1/whatsapp/groups?channelId=<uuid>
Authorization: Bearer <token>
```

Retorna todos os grupos em que o bot participa na sessão Baileys do canal informado. Requer canal com status `ACTIVE` ou `WARMING`.

**Response:**
```json
[
  {
    "id": "120363123456789012@g.us",
    "name": "Grupo Pastoral Familiar",
    "participantsCount": 47
  }
]
```

### Envio para grupo

Passe o `id` do grupo (formato `@g.us`) no campo `recipientPhone` do endpoint de envio:

```bash
POST /v1/notifications/send
Content-Type: application/json
Authorization: Bearer <token>

{
  "organizationId": "<uuid>",
  "channelType": "WHATSAPP",
  "recipientName": "Grupo Pastoral Familiar",
  "recipientPhone": "120363123456789012@g.us",
  "message": "Aviso: missa de quarta-feira confirmada às 19h30."
}
```

O chatId `@g.us` é detectado automaticamente — a verificação individual (`onWhatsApp()`) é ignorada e a mensagem vai direto para o grupo.

### Dashboard

Na tela **Notificações**, botão **Nova Notificação**:

1. Selecione o canal **WhatsApp**
2. Em **Tipo de destinatário**, escolha **Grupo**
3. Selecione o **Canal WhatsApp** (sessão Baileys ativa ou em aquecimento)
4. Escolha o **Grupo** no dropdown — carregado em tempo real da sessão
5. Preencha o nome e a mensagem e clique em **Enfileirar**

---

## Hierarquia organizacional

```
Plataforma (OWNER)
  └── Paróquias (SUPER_ADMIN)
        └── Comunidades (ADMIN, OPERATOR)
```

Cada nível possui visibilidade e permissões isoladas. Não há auto-cadastro público — todo usuário é criado por um superior na hierarquia.

---

## Stack

| Camada         | Tecnologia                    |
| -------------- | ----------------------------- |
| Runtime        | Node.js + TypeScript          |
| Framework      | Fastify v5                    |
| Validação      | Zod                           |
| Autenticação   | JWT (8h) + bcrypt             |
| WhatsApp       | Baileys                       |
| Email          | Nodemailer                    |
| Telegram       | node-telegram-bot-api         |
| Fila e retry   | BullMQ + Redis                |
| Banco de dados | PostgreSQL 16                 |
| ORM            | Prisma                        |
| Criptografia   | AES-256 (Node crypto)         |
| Real-time      | SSE (QR Code onboarding)      |
| Dashboard      | React + Recharts              |
| Infra          | Docker Compose (single VPS)   |
| Documentação   | Swagger UI em `/docs`         |

---

## Início rápido

### Pré-requisitos

- Node.js 20+
- Docker e Docker Compose

### 1. Clonar e configurar

```bash
git clone <repo>
cd herald
cp .env.example .env
# Editar .env com suas credenciais
```

### 2. Subir a infra (Postgres + Redis)

```bash
docker compose -f docker-compose.dev.yml up -d
```

### 3. Migrations e seed

```bash
npm install
npm run db:migrate   # cria as tabelas
npm run db:seed      # cria o usuário OWNER inicial
```

### 4. Rodar a API

```bash
npm run dev
```

A API estará disponível em `http://localhost:3000`.
Swagger UI em `http://localhost:3000/docs`.

### Login inicial

```
Email:  admin@herald.app
Senha:  Admin@1234
```

> Altere a senha após o primeiro login.

---

## Deploy em Produção (VPS)

### Pré-requisitos

- Ubuntu 22.04 / 24.04
- Docker e Docker Compose instalados
- Acesso SSH à VPS

### 1. Clonar o repositório

```bash
ssh usuario@IP_DA_VPS
git clone https://github.com/seu-usuario/herald.git
cd herald
```

### 2. Configurar variáveis de ambiente

```bash
cp .env.example .env
nano .env
```

Gere strings seguras para os campos criptográficos:

```bash
# Rodar 3 vezes — uma para JWT_SECRET, uma para CRYPTO_KEY, uma para POSTGRES_PASSWORD
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> `CRYPTO_KEY` deve ter **exatamente 32 caracteres** (AES-256). Use os primeiros 32 do output hex.

### 3. Configurar o frontend

```bash
# Substitua IP_DA_VPS pelo IP ou domínio da sua VPS
echo "VITE_API_URL=http://IP_DA_VPS" > dashboard/.env.production
```

Se estiver usando domínio com HTTPS: `echo "VITE_API_URL=https://seu-dominio.com" > dashboard/.env.production`

### 4. Criar diretório de sessões WhatsApp

```bash
mkdir -p whatsapp-sessions
```

### 5. Subir os serviços

```bash
docker compose up --build -d
```

Isso sobe: **API** (porta 3000 interna) + **PostgreSQL** + **Redis** + **Frontend** (nginx na porta 80).

### 6. Rodar as migrations

```bash
docker compose exec api npx prisma migrate deploy
```

### 7. Rodar o seed

Cria o primeiro usuário OWNER. **Guarde as credenciais exibidas.**

```bash
docker compose exec api npx prisma db seed
```

Credenciais padrão (altere no `.env` antes do seed ou via dashboard após o login):

```
Email: admin@herald.app
Senha: Admin@1234
```

### 8. Verificar o deploy

```bash
# Status dos containers
docker compose ps

# Logs da API (últimas 50 linhas)
docker compose logs api --tail=50

# Testar a API
curl http://IP_DA_VPS/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@herald.app","password":"Admin@1234"}'
```

### Acesso

| Serviço | URL |
| ------- | --- |
| Dashboard | `http://IP_DA_VPS` |
| API REST | `http://IP_DA_VPS/v1` |
| Swagger UI | `http://IP_DA_VPS/docs` |

### Atualizar para nova versão

```bash
git pull
docker compose up --build -d
docker compose exec api npx prisma migrate deploy
```

### Variáveis de ambiente obrigatórias

| Variável | Descrição | Obrigatória |
| -------- | --------- | ----------- |
| `NODE_ENV` | Ambiente (`development` \| `production`) | ✅ |
| `PORT` | Porta da API (padrão: `3000`) | ✅ |
| `APP_URL` | URL base da aplicação (usada em links de email) | ✅ |
| `DATABASE_URL` | Connection string do PostgreSQL | ✅ |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL (docker-compose) | ✅ |
| `POSTGRES_USER` | Usuário do PostgreSQL (padrão: `herald`) | Opcional |
| `POSTGRES_DB` | Nome do banco (padrão: `herald`) | Opcional |
| `REDIS_URL` | Connection string do Redis | ✅ |
| `JWT_SECRET` | Segredo JWT — mínimo 32 caracteres | ✅ |
| `CRYPTO_KEY` | Chave AES-256 — **exatamente 32 caracteres** | ✅ |
| `SMTP_HOST` | Servidor SMTP (recuperação de senha + alertas) | Opcional |
| `SMTP_PORT` | Porta SMTP (padrão: `587`) | Opcional |
| `SMTP_USER` | Usuário SMTP | Opcional |
| `SMTP_PASS` | Senha SMTP | Opcional |
| `SMTP_FROM` | Remetente SMTP (ex: `"Herald <no-reply@dominio.com>"`) | Opcional |
| `WA_SESSIONS_PATH` | Diretório de sessões Baileys (padrão: `./whatsapp-sessions`) | Opcional |
| `DAILY_RESET_TZ` | Timezone do cron de reset diário — nome IANA (padrão: `UTC`). Brasil: `America/Sao_Paulo` | Opcional |
| `SEED_OWNER_NAME` | Nome do usuário OWNER criado no seed | Opcional |
| `SEED_OWNER_EMAIL` | Email do OWNER (padrão: `admin@herald.app`) | Opcional |
| `SEED_OWNER_PASSWORD` | Senha do OWNER (padrão: `Admin@1234`) | Opcional |

> Sem SMTP configurado, emails de recuperação de senha e alertas são apenas logados no console.

---

## Comandos

```bash
npm run dev              # API em modo watch
npm run build            # build para produção
npm run start            # rodar o build
npm run db:migrate       # criar e aplicar migration
npm run db:migrate:prod  # aplicar migrations em produção
npm run db:seed          # seed inicial (OWNER)
npm run db:studio        # Prisma Studio (GUI do banco)
npm test                 # todos os testes
```

---

## Produção (Docker Compose)

```bash
# Defina as variáveis obrigatórias antes de subir (ou use um .env)
export POSTGRES_PASSWORD=senha-segura
export JWT_SECRET=segredo-com-no-minimo-32-chars
export CRYPTO_KEY=chave-aes256-exatamente-32chars

docker compose up -d               # API + Postgres + Redis + Frontend
docker compose logs -f api         # acompanhar logs da API
docker compose up -d --build api   # rebuild após deploy
```

O dashboard React é servido via nginx na porta **80** com proxy reverso para `/v1/*` e `/docs`.

---

## Variáveis de ambiente

| Variável            | Descrição                                         | Obrigatória |
| ------------------- | ------------------------------------------------- | ----------- |
| `DATABASE_URL`      | Connection string do PostgreSQL                   | ✅          |
| `REDIS_URL`         | Connection string do Redis                        | ✅          |
| `JWT_SECRET`        | Segredo JWT (mínimo 32 caracteres)                | ✅          |
| `CRYPTO_KEY`        | Chave AES-256 (exatamente 32 caracteres)          | ✅          |
| `POSTGRES_PASSWORD` | Senha do PostgreSQL (docker-compose)              | ✅          |
| `POSTGRES_USER`     | Usuário do PostgreSQL (padrão: `herald`)          | Opcional    |
| `POSTGRES_DB`       | Nome do banco (padrão: `herald`)                  | Opcional    |
| `SMTP_HOST`         | Servidor SMTP para recuperação de senha e alertas | Opcional    |
| `SMTP_PORT`         | Porta SMTP (padrão: 587)                          | Opcional    |
| `SMTP_USER`         | Usuário SMTP                                      | Opcional    |
| `SMTP_PASS`         | Senha SMTP                                        | Opcional    |
| `APP_URL`           | URL base da aplicação                             | Opcional    |
| `DAILY_RESET_TZ`    | Timezone para cron de reset diário (padrão: UTC)  | Opcional    |

Sem SMTP configurado, emails são apenas logados no console.

---

## Fluxo de entrega

```
API Externa → POST /v1/notifications/send
    │
    ▼
Fila BullMQ
    │
    ▼
Worker tenta canal/número
    ├── Sucesso → ENVIADO ✅
    └── Falha → próximo número do pool
                    └── Pool esgotado → retry automático
                                          +1h → +6h → +24h
                                              └── FALHOU_DEFINITIVO
                                                  → alerta Telegram
                                                  → reenvio manual
```

---

## Segurança

- JWT com expiração de 8h
- Senhas com bcrypt (salt rounds: 12)
- Credentials de canais criptografadas em repouso (AES-256)
- Isolamento por `organizationId` em todas as queries
- Token de reset de senha com expiração de 1h e uso único
- API Key por organização para chamadas da API externa

---

## Fases de desenvolvimento

| Fase | Descrição                              | Status     |
| ---- | -------------------------------------- | ---------- |
| 1    | Fundação: auth, orgs, usuários         | ✅ Completa |
| 2    | Entrega via Email + fila BullMQ        | ✅ Completa |
| 3    | WhatsApp: Baileys + QR Code + SSE      | ✅ Completa |
| 4    | Telegram + retry ciclos + alertas      | ✅ Completa |
| 5    | Anti-banimento + agendamento + broadcast + API Key | ✅ Completa |
| 6    | Dashboard React + auditoria completa   | ✅ Completa |

---

## Estrutura do projeto

```
src/
├── http/
│   ├── routes/          # auth, organizations, users, channels, notifications
│   ├── middlewares/     # authenticate, scope-guard
│   └── errors/          # AppError, handler global
├── workers/             # BullMQ workers (notificações, agendamento)
├── queues/              # definição das filas
├── channels/            # clientes WhatsApp (Baileys), Email, Telegram
├── alerts/              # serviço de alertas críticos
├── lib/                 # prisma, crypto, mailer, audit, env
└── types/               # augmentations TypeScript
prisma/
├── schema.prisma        # modelo de dados completo
└── seed.ts              # seed do OWNER inicial
```

---

## Licença

Proprietary — todos os direitos reservados.
