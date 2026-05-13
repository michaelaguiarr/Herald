# Herald Dashboard

Painel administrativo web do Herald — serviço de entrega de notificações multi-canal (WhatsApp, Email, Telegram).

**Stack:** React 18 · Vite · TypeScript · Tailwind CSS · Shadcn/ui · Zustand · Axios · Recharts

---

## Desenvolvimento local

```bash
# Instalar dependências
npm install

# Iniciar o servidor de desenvolvimento (porta 5173)
npm run dev
```

O Vite proxy em `vite.config.ts` redireciona `/v1/*` para `http://localhost:3000`.  
A API Herald deve estar rodando localmente antes de abrir o dashboard.

---

## Build de produção

### Via Docker (recomendado)

```bash
# Build da imagem
docker build -t herald-dashboard ./dashboard

# Executar standalone (sem API)
docker run -p 80:80 herald-dashboard

# Com VITE_API_URL customizado
docker build --build-arg VITE_API_URL=https://api.example.com -t herald-dashboard ./dashboard
```

### Via npm

```bash
npm run build   # gera dist/
npm run preview # preview local do build
```

---

## Variáveis de ambiente

| Variável | Descrição | Default |
|---|---|---|
| `VITE_API_URL` | URL base da API Herald | Não necessário — o nginx faz proxy de `/v1/` para `http://api:3000` internamente |

Em produção com `docker-compose`, o nginx proxia `/v1/` diretamente para o serviço `api:3000` na rede interna do Docker. `VITE_API_URL` só é necessário se o frontend e a API estiverem em domínios separados.

---

## Docker Compose (produção completa)

```bash
# Na raiz do projeto Herald
docker compose up -d --build

# Frontend disponível em: http://localhost
# API disponível em:      http://localhost:3000
```

---

## Refresh token e cookie httpOnly em produção

O Herald usa uma estratégia de dois tokens:

- **Access token (8h):** armazenado em memória (Zustand). Perdido ao fechar a aba — o `BootLoader` o renova automaticamente via refresh token.
- **Refresh token (30d):** armazenado como cookie `httpOnly; SameSite=Lax`. Enviado automaticamente pelo browser para `/v1/auth/refresh`.

### Pontos de atenção em produção

1. **Mesmo domínio (docker-compose):** funciona sem configuração adicional. O nginx recebe o cookie e o encaminha para a API via proxy.

2. **Domínios separados (frontend em CDN, API em VPS):** o cookie `SameSite=Lax` não é enviado cross-origin. Neste cenário é necessário:
   - Configurar `SameSite=None; Secure` no cookie do backend
   - Servir ambos via HTTPS
   - Configurar CORS na API com `credentials: true` e `origin` explícito

3. **HTTPS:** Em produção, coloque um reverse proxy (Nginx/Caddy) com TLS na frente do docker-compose. O nginx interno do dashboard não precisa de TLS — só o proxy externo.
