# Herald Dashboard — Frontend

Painel administrativo web do Herald. Thin client: nenhuma regra de negócio vive aqui. Consome exclusivamente a API REST do Herald.

PRD completo: `herald-dashboard-prd.md`

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | React 18 + Vite |
| Linguagem | TypeScript (strict) |
| Componentes | Shadcn/ui |
| Estilo | Tailwind CSS |
| Gráficos | Recharts |
| Roteamento | React Router v6 |
| Estado global | Zustand |
| HTTP client | Axios com interceptors |
| Formulários | React Hook Form + Zod |
| QR Code | qrcode.react |
| Ícones | Lucide React |

---

## Comandos

```bash
# Desenvolvimento
npm run dev

# Build de produção
npm run build

# Preview do build
npm run preview

# Lint
npm run lint
```

---

## Estrutura de Pastas

```
dashboard/
  src/
    components/
      ui/           -- componentes Shadcn/ui (nunca editar diretamente)
      layout/       -- Sidebar, Header, BottomNav
      shared/       -- Badge, DataTable, ConfirmDialog, EmptyState, SkeletonTable
    pages/
      Login.tsx
      Dashboard.tsx
      Notifications.tsx
      FailedNotifications.tsx
      WhatsAppSessions.tsx
      Channels.tsx
      Users.tsx
      Organizations.tsx
      AuditLog.tsx
    hooks/
      useAuth.ts
      useNotifications.ts
      useDashboard.ts
      useChannels.ts
    services/
      api.ts                      -- instância Axios + interceptor 401
      auth.service.ts
      notifications.service.ts
      channels.service.ts
      users.service.ts
      organizations.service.ts
      dashboard.service.ts
    store/
      auth.store.ts               -- Zustand: token em memória, user, perfil
    types/
      api.types.ts                -- tipos espelhando contratos da API Herald
    lib/
      utils.ts
```

---

## Perfis e Acesso

| Tela | OWNER | SUPER_ADMIN | ADMIN | OPERATOR |
|---|---|---|---|---|
| Login | ✅ | ✅ | ✅ | ✅ |
| Dashboard | ✅ todas as orgs | ✅ sua org | ✅ sua filial | ✅ sua filial |
| Falhas Definitivas | ✅ | ✅ | ✅ | ✅ (só visualiza) |
| Sessões WhatsApp | ✅ | ✅ | ✅ | ❌ |
| Notificações | ✅ | ✅ | ✅ | ✅ (só visualiza) |
| Canais | ✅ | ✅ | ✅ | ❌ |
| Usuários | ✅ | ✅ | ✅ | ❌ |
| Organizações | ✅ only | ❌ | ❌ | ❌ |
| Audit Log | ✅ | ✅ | ✅ | ❌ |

---

## Fases de Desenvolvimento

### Fase 1 — Fundação
- Setup Vite + React + TypeScript + Tailwind + Shadcn/ui
- Instância Axios em `services/api.ts` com interceptor de 401 → redirect para login
- Zustand store de autenticação (token em memória, nunca localStorage)
- Tela de Login + fluxo de recuperação de senha
- Layout base: Sidebar fixo (desktop) + Bottom Navigation (mobile)
- React Router v6 com rota protegida (`ProtectedRoute`)
- Ocultação de itens do menu por perfil do usuário autenticado

### Fase 2 — Dashboard e Notificações
- Tela Dashboard: KPIs, seletor de período, gráfico de barras e pizza (Recharts), lista de sessões WA, polling 60s
- Tela Notificações: tabela paginada, filtros (canal/status/período), drawer lateral de detalhes + tentativas, botão reenvio, aba "Agendadas"
- Tela Falhas Definitivas: lista FALHOU_DEFINITIVO, filtro por canal, reenvio com loading, badge dinâmico no menu

### Fase 3 — Canais e Sessões WhatsApp
- Tela Sessões WhatsApp: cards por sessão com badge de status, modal QR Code via SSE (refresh 30s, timeout 60s), botão reconectar, barra de progresso de aquecimento (7 dias)
- Tela Canais: lista com tipo/label/status/limites, formulário de criação por tipo (WA / Email / Telegram), edição inline, desativação com confirmação

### Fase 4 — Usuários e Organizações
- Tela Usuários: tabela CRUD, filtro por hierarquia (ADMIN só cria OPERATOR), campo telegramId, reset de senha com confirmação
- Tela Organizações (OWNER only): árvore visual Organização→Filiais, criação/desativação, geração e revogação de API Key (exibida uma única vez, com botão copiar)

### Fase 5 — Audit Log e Polimento
- Tela Audit Log: tabela paginada, filtros (ação/recurso/período), badge ator humano vs. sistema, exportação CSV
- Skeleton loaders em todas as tabelas e cards
- Empty states com ilustração e mensagem em todas as telas
- Testes de responsividade mobile
- Dockerfile nginx para build de produção

---

## Convenções de Código

### Arquivos e pastas
- PascalCase para componentes e páginas: `Notifications.tsx`, `ConfirmDialog.tsx`
- camelCase para hooks, services e stores: `useAuth.ts`, `auth.service.ts`, `auth.store.ts`
- Kebab-case proibido em componentes React — reservado para config files
- Um arquivo por componente — sem barrel exports desnecessários

### TypeScript
- `strict: true` sempre ligado
- Sem `any` — usar `unknown` com narrowing quando necessário
- Tipos de request/response definidos em `types/api.types.ts` e reutilizados em services e hooks
- Props de componentes definidas como `interface`, não `type` (exceto unions)

### Estado e dados
- Token JWT armazenado **somente em memória** (Zustand store) — nunca em localStorage ou sessionStorage
- `organizationId` e `role` do usuário vêm do store de auth, nunca do corpo de qualquer request
- Nenhuma chamada de API fora de `services/` — hooks chamam services, componentes chamam hooks

### Formulários
- React Hook Form + Zod em todos os formulários — sem validação ad hoc
- Schema Zod define o tipo via `z.infer<>`, não redefinir manualmente

### Componentes Shadcn/ui
- Componentes em `src/components/ui/` não são editados diretamente
- Customizações via `className` (Tailwind) ou wrapper em `components/shared/`

### Comportamentos globais obrigatórios
- **401:** interceptor Axios redireciona para `/login` e limpa o store de auth
- **Loading:** skeleton loader em toda tabela e card durante fetch
- **Erro de API:** banner com botão "Tentar novamente"
- **Empty state:** ilustração + mensagem quando lista vazia
- **Ações destrutivas:** sempre precedidas de `ConfirmDialog`
- **Feedback:** toast de sucesso e erro em toda ação (reenvio, criação, edição, exclusão)
- **Responsividade:** sidebar → bottom nav em mobile; tabelas → cards empilhados

### Segurança
- Nunca logar tokens, credenciais ou dados sensíveis no console
- `role` e `organizationId` validados no backend — o frontend oculta UI mas nunca assume que o backend dispensará a verificação
- QR Code SSE: fechar conexão ao desmontar o componente (`EventSource.close()`)

---

## Dívidas Técnicas

### Antes de produção (bloqueadoras)
Nenhuma — os três itens identificados na revisão final foram resolvidos:
- OPERATOR não vê botão Reenviar em Notificações e Falhas Definitivas ✅
- Criação de canal WhatsApp redireciona para `/whatsapp` ✅
- `README.md` documentando dev, build e cookie httpOnly ✅

### Melhorias futuras (não bloqueadoras)

| Item | Impacto | Detalhe |
|---|---|---|
| **`as never` no zodResolver** | Sem impacto em runtime | Workaround para incompatibilidade entre Zod v4 e `@hookform/resolvers`. Resolver: aguardar atualização do `@hookform/resolvers` com suporte oficial a Zod v4, ou migrar Zod para v3. Afeta `Users.tsx` e `Organizations.tsx`. |
| **Tabelas → card stacks no mobile** | UX mobile parcial | Tabelas atualmente scrollam horizontalmente (`overflow-x-auto`). O PRD pede "cards empilhados". Requer refatoração com componente `DataTable` responsivo ou duplicate layout condicional. |
| **Date range filter para Notificações e Audit Log** | Filtragem por período ausente | A API `GET /notifications` e `GET /audit-logs` não expõem `startDate`/`endDate`. A mudança requer nova query no backend antes de implementar no frontend. |
| **Code splitting com React.lazy()** | Bundle de 1MB no initial load | Usar `React.lazy()` + `Suspense` por rota reduz o bundle inicial ~60%. Cada página vira um chunk separado. |
| **Error boundary global** | Erros de render mostram tela branca | Adicionar `<ErrorBoundary>` no `App.tsx` envolvendo as rotas. React 18 suporta `useErrorBoundary` hook ou o wrapper clássico. |
| **Dark mode toggle** | Tailwind suporta, UI não expõe | `tailwind.config.js` tem `darkMode: 'class'` configurado. Basta adicionar botão no Header/Sidebar que alterna a classe `dark` no `<html>`. |
| **Persistência de paginação** | Navegar entre páginas reseta filtros | Usar `URLSearchParams` ou Zustand para preservar `page`, `status`, `channelType` no histórico do browser. |
| **Polling → SSE/WebSocket** | Carga de rede desnecessária | Dashboard e Sessões WhatsApp usam polling (60s/30s). Migrar para push reduz latência e carga. Requer suporte no backend. |
