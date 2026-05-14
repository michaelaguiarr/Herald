#!/bin/sh
set -e

echo "Aguardando PostgreSQL..."
until nc -z postgres 5432; do
  sleep 1
done
echo "PostgreSQL disponível."

echo "Aguardando Redis..."
until nc -z redis 6379; do
  sleep 1
done
echo "Redis disponível."

echo "Rodando migrations..."
npx prisma migrate deploy

echo "Iniciando API..."
exec node dist/server.js
