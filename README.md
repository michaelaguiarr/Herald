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
docker compose up -d          # sobe API + Postgres + Redis
docker compose logs -f api    # acompanhar logs
docker compose up -d --build api  # rebuild após deploy
```

---

## Variáveis de ambiente

| Variável            | Descrição                                  | Obrigatória |
| ------------------- | ------------------------------------------ | ----------- |
| `DATABASE_URL`      | Connection string do PostgreSQL            | ✅          |
| `REDIS_URL`         | Connection string do Redis                 | ✅          |
| `JWT_SECRET`        | Segredo JWT (mínimo 32 caracteres)         | ✅          |
| `CRYPTO_KEY`        | Chave AES-256 (exatamente 32 caracteres)   | ✅          |
| `SMTP_HOST`         | Servidor SMTP para recuperação de senha    | Opcional    |
| `SMTP_PORT`         | Porta SMTP (padrão: 587)                   | Opcional    |
| `SMTP_USER`         | Usuário SMTP                               | Opcional    |
| `SMTP_PASS`         | Senha SMTP                                 | Opcional    |
| `APP_URL`           | URL base da aplicação                      | Opcional    |

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
| 2    | Entrega via Email + fila BullMQ        | 🔲 Pendente |
| 3    | WhatsApp: Baileys + QR Code            | 🔲 Pendente |
| 4    | Telegram + retry + alertas críticos    | 🔲 Pendente |
| 5    | Anti-banimento + agendamento + broadcast | 🔲 Pendente |
| 6    | Dashboard React + auditoria completa   | 🔲 Pendente |

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
