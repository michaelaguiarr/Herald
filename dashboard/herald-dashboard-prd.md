# PRD — Herald Dashboard (Frontend)
**Versão 1.0**

---

## Visão Geral

Painel administrativo web do Herald, responsivo para desktop e mobile, com acesso restrito por autenticação JWT. Cada perfil de usuário (OWNER, SUPER_ADMIN, ADMIN, OPERATOR) vê apenas os dados e funcionalidades pertinentes ao seu escopo organizacional.

O frontend consome exclusivamente a API REST do Herald. Nenhuma regra de negócio vive no frontend.

---

## Perfis e Acesso por Tela

| Tela | OWNER | SUPER_ADMIN | ADMIN | OPERATOR |
|---|---|---|---|---|
| Login | ✅ | ✅ | ✅ | ✅ |
| Visão Geral (Dashboard) | ✅ todas as Organizaçãos | ✅ sua Organização | ✅ sua Filial | ✅ sua Filial |
| Falhas Definitivas | ✅ | ✅ | ✅ | ✅ (só visualiza) |
| Sessões WhatsApp | ✅ | ✅ | ✅ | ❌ |
| Notificações | ✅ | ✅ | ✅ | ✅ (só visualiza) |
| Canais | ✅ | ✅ | ✅ | ❌ |
| Usuários | ✅ | ✅ | ✅ | ❌ |
| Organizações | ✅ only | ❌ | ❌ | ❌ |
| Audit Log | ✅ | ✅ | ✅ | ❌ |

---

## Telas e Funcionalidades

### 1. Login
- Formulário de email e senha
- Link "Esqueci minha senha" → fluxo de recuperação por email
- Token JWT armazenado em memória (não em localStorage)
- Redirecionamento automático para Dashboard após login
- Exibição de erro claro em credenciais inválidas

### 2. Visão Geral (Dashboard)
Tela principal após login.

- Cards de KPIs no topo:
    - Total enviado
    - Taxa de entrega (%)
    - Falhas definitivas pendentes
    - Canais WhatsApp ativos
- Seletor de período: Hoje / 7 dias / 30 dias
- Gráfico de barras: envios por status ao longo do período
- Gráfico de pizza: distribuição por canal (WhatsApp, Email, Telegram)
- Lista de sessões WhatsApp com status em tempo real (badge colorido)
- Atualização automática a cada 60 segundos

### 3. Notificações
Lista completa de notificações com filtros e ações.

- Tabela paginada com colunas: destinatário, canal, status, data, ações
- Filtros: canal, status, período (date range picker)
- Badge de status com cores: ENVIADO (verde), PENDENTE (amarelo), FALHOU (laranja), FALHOU_DEFINITIVO (vermelho), AGENDADO (azul)
- Botão "Reenviar" em notificações com status FALHOU, FALHOU_DEFINITIVO e ENVIADO
- Drawer lateral ao clicar em uma notificação: detalhes completos + histórico de tentativas
- Aba separada "Agendadas" mostrando notificações com status AGENDADO

### 4. Falhas Definitivas
Fila de atenção para notificações que esgotaram todos os ciclos de retry.

- Lista destacada com notificações FALHOU_DEFINITIVO
- Filtro por canal
- Botão "Reenviar" por item com feedback visual (loading + confirmação)
- Contador de falhas no badge do menu lateral (atualiza em tempo real)

### 5. Sessões WhatsApp
Gerenciamento de canais WhatsApp com QR Code.

- Cards por sessão: número/label, status com badge, última atividade
- Status com cores: WARMING (azul), ACTIVE (verde), DISCONNECTED (amarelo), BANNED (vermelho)
- Botão "Conectar" → abre modal com QR Code via SSE (atualiza a cada 30s, timeout 60s)
- Botão "Reconectar" para sessões DISCONNECTED
- Indicador visual de aquecimento: progresso dos 7 dias para WARMING
- Sessões BANNED desabilitadas com mensagem explicativa

### 6. Canais
CRUD completo de canais (WhatsApp, Email, Telegram).

- Lista de canais com tipo, label, status e limites configurados
- Formulário de criação por tipo:
    - WhatsApp: label + limites diário/hora (credenciais gerenciadas via Sessões)
    - Email: label + SMTP host, porta, usuário, senha, from
    - Telegram: label + botToken
- Edição inline de label e limites
- Desativação de canal com confirmação

### 7. Usuários
Gestão de usuários dentro do escopo do perfil autenticado.

- Tabela com nome, email, perfil, organização, status e última atividade
- Botão "Novo usuário" → formulário com nome, email, perfil e organização
- Edição de perfil e status (ativo/inativo)
- Botão "Resetar senha" com confirmação
- Campo `telegramId` editável para configurar alertas
- Perfis disponíveis filtrados pela hierarquia (ADMIN só cria OPERATOR, etc.)

### 8. Organizações (OWNER only)
Gestão da estrutura hierárquica da plataforma.

- Árvore visual: Organizaçãos → Filials
- Criação de Organização e Filial com nome
- Desativação de organização com confirmação
- Geração e revogação de API Key por organização
- API Key exibida uma única vez após geração (com botão copiar)

### 9. Audit Log
Histórico de ações para rastreabilidade.

- Tabela paginada com: data, usuário, ação, recurso afetado
- Filtros: tipo de ação, tipo de recurso, período
- Badge diferenciando ator humano de ação automática do sistema
- Exportação CSV do período filtrado

---

## Navegação

```
Sidebar fixa (desktop) / Bottom nav (mobile)
  ├── 📊 Visão Geral
  ├── 🔔 Notificações
  │     └── badge com total de FALHOU_DEFINITIVO
  ├── 🔴 Falhas Definitivas
  ├── 📱 Sessões WhatsApp
  ├── 📡 Canais
  ├── 👥 Usuários
  ├── 🏛️ Organizações (OWNER only)
  ├── 📋 Audit Log
  └── ⚙️ Perfil / Logout
```

Itens do menu ocultados automaticamente conforme perfil do usuário autenticado.

---

## Comportamentos Globais

- **Token expirado:** interceptor nas chamadas de API detecta 401 e redireciona para login automaticamente
- **Loading states:** skeleton loader em todas as tabelas e cards durante carregamento
- **Error states:** banner de erro com botão "Tentar novamente" em falhas de API
- **Empty states:** ilustração e mensagem descritiva quando não há dados
- **Toasts:** feedback de sucesso e erro em todas as ações (reenvio, criação, edição)
- **Responsividade:** sidebar vira bottom navigation em mobile; tabelas viram cards empilhados
- **Confirmações:** modal de confirmação em ações destrutivas (desativar, resetar senha, revogar API Key)

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | React 18 + Vite |
| Linguagem | TypeScript |
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

## Estrutura de Pastas

```
dashboard/
  src/
    components/
      ui/           -- componentes Shadcn/ui
      layout/       -- Sidebar, Header, BottomNav
      shared/       -- Badge, DataTable, ConfirmDialog, EmptyState
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
      api.ts          -- instância Axios com interceptors
      auth.service.ts
      notifications.service.ts
      channels.service.ts
      users.service.ts
      organizations.service.ts
      dashboard.service.ts
    store/
      auth.store.ts   -- Zustand: token, user, perfil
    types/
      api.types.ts    -- tipos espelhando contratos da API Herald
    lib/
      utils.ts
```

---

## Fases de Desenvolvimento

### Fase 1 — Fundação
- Setup Vite + React + TypeScript + Tailwind + Shadcn/ui
- Configuração do Axios com interceptor de 401
- Zustand store de autenticação
- Tela de Login com recuperação de senha
- Layout base: Sidebar (desktop) + Bottom nav (mobile)
- Roteamento com React Router v6 e rota protegida por auth
- Ocultação de menu por perfil

### Fase 2 — Dashboard e Notificações
- Tela Visão Geral com KPIs, gráficos Recharts e sessões WA
- Tela Notificações com tabela, filtros, drawer de detalhes e reenvio
- Tela Falhas Definitivas com fila e ações
- Badge dinâmico no menu com contador de falhas

### Fase 3 — Canais e Sessões WhatsApp
- Tela Sessões WhatsApp com QR Code via SSE
- Tela Canais com CRUD por tipo
- Modal de QR Code com timeout e auto-refresh

### Fase 4 — Usuários e Organizações
- Tela Usuários com CRUD filtrado por perfil
- Tela Organizações (OWNER) com árvore e gestão de API Key
- Fluxo de geração e cópia de API Key

### Fase 5 — Audit Log e Polimento
- Tela Audit Log com filtros e exportação CSV
- Empty states e skeleton loaders em todas as telas
- Testes de responsividade mobile
- Dockerfile nginx para build de produção

---

## Critérios de Aceite (MVP)

**Autenticação**
- [ ] Login com email e senha funcional
- [ ] Recuperação de senha por email
- [ ] Redirecionamento automático em token expirado
- [ ] Menu filtrado por perfil do usuário autenticado

**Dashboard**
- [ ] KPIs carregam dados reais da API
- [ ] Gráficos respondem ao seletor de período
- [ ] Status das sessões WhatsApp em tempo real
- [ ] Atualização automática a cada 60 segundos

**Notificações**
- [ ] Tabela paginada com filtros funcionais
- [ ] Drawer com detalhes e histórico de tentativas
- [ ] Reenvio com feedback visual
- [ ] Aba de agendadas separada

**Sessões WhatsApp**
- [ ] QR Code renderizado via SSE
- [ ] Status atualiza ao escanear
- [ ] Reconexão funcional
- [ ] Progresso de aquecimento visível

**Canais**
- [ ] CRUD de canais Email e Telegram
- [ ] Criação de canal WhatsApp com redirecionamento para Sessões

**Usuários**
- [ ] CRUD filtrado pela hierarquia de perfis
- [ ] Campo telegramId editável
- [ ] Reset de senha com confirmação

**Organizações (OWNER)**
- [ ] Árvore Organização → Filials
- [ ] Geração e revogação de API Key
- [ ] API Key copiável exibida uma única vez

**Audit Log**
- [ ] Tabela paginada com filtros
- [ ] Distinção visual entre ator humano e sistema
- [ ] Exportação CSV

**UX Global**
- [ ] Skeleton loaders em todos os carregamentos
- [ ] Empty states descritivos
- [ ] Toasts de feedback em todas as ações
- [ ] Layout responsivo desktop e mobile
- [ ] Confirmação em ações destrutivas