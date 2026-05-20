#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Cores ──────────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

info()  { echo -e "${CYAN}[herald]${NC} $*"; }
ok()    { echo -e "${GREEN}[herald]${NC} $*"; }
warn()  { echo -e "${YELLOW}[herald]${NC} $*"; }
fatal() { echo -e "${RED}[herald]${NC} $*" >&2; exit 1; }

# ── Dependências do sistema ────────────────────────────────────────────────────
for cmd in docker node npm; do
  command -v "$cmd" &>/dev/null || fatal "'$cmd' não encontrado. Instale antes de continuar."
done

# ── .env ──────────────────────────────────────────────────────────────────────
if [[ ! -f "$ROOT/.env" ]]; then
  if [[ -f "$ROOT/.env.example" ]]; then
    cp "$ROOT/.env.example" "$ROOT/.env"
    warn ".env não encontrado — copiado de .env.example. Revise as variáveis antes de usar em produção."
  else
    fatal ".env e .env.example não encontrados. Crie o arquivo .env manualmente."
  fi
else
  info ".env encontrado."
fi

# ── Docker: infra (Postgres + Redis) ──────────────────────────────────────────
info "Subindo infra (Postgres + Redis)..."
docker compose -f "$ROOT/docker-compose.dev.yml" up -d

# Aguarda Postgres aceitar conexões (até 30s)
info "Aguardando Postgres ficar pronto..."
for i in $(seq 1 30); do
  if docker compose -f "$ROOT/docker-compose.dev.yml" exec -T postgres \
      pg_isready -U "${POSTGRES_USER:-herald}" &>/dev/null 2>&1; then
    ok "Postgres pronto."
    break
  fi
  if [[ $i -eq 30 ]]; then
    fatal "Postgres não respondeu após 30s. Verifique os logs: docker compose -f docker-compose.dev.yml logs postgres"
  fi
  sleep 1
done

# ── Dependências Node.js ───────────────────────────────────────────────────────
if [[ ! -d "$ROOT/node_modules" ]]; then
  info "Instalando dependências da API..."
  npm install --prefix "$ROOT"
fi

if [[ ! -d "$ROOT/dashboard/node_modules" ]]; then
  info "Instalando dependências do dashboard..."
  npm install --prefix "$ROOT/dashboard"
fi

# ── Migrations Prisma ──────────────────────────────────────────────────────────
info "Aplicando migrations do banco..."
npm run --prefix "$ROOT" prisma:migrate:dev 2>/dev/null \
  || npx --prefix "$ROOT" prisma migrate deploy 2>/dev/null \
  || warn "Migrations puladas (verifique se DATABASE_URL está correto no .env)"

# ── Subir API e dashboard em paralelo ─────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BOLD}  Herald — ambiente de desenvolvimento${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  API      → ${CYAN}http://localhost:3000${NC}"
echo -e "  Swagger  → ${CYAN}http://localhost:3000/docs${NC}"
echo -e "  Dashboard→ ${CYAN}http://localhost:5173${NC}"
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  Ctrl+C encerra ambos os processos."
echo ""

# Trap para matar filhos ao Ctrl+C
cleanup() {
  echo ""
  info "Encerrando processos..."
  kill "$API_PID" "$DASH_PID" 2>/dev/null || true
  wait "$API_PID" "$DASH_PID" 2>/dev/null || true
  ok "Encerrado. A infra Docker continua rodando."
  echo -e "  Para parar:  ${CYAN}docker compose -f docker-compose.dev.yml down${NC}"
}
trap cleanup INT TERM

npm run dev --prefix "$ROOT" &
API_PID=$!

npm run dev --prefix "$ROOT/dashboard" &
DASH_PID=$!

wait "$API_PID" "$DASH_PID"