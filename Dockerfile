FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma/
COPY patches ./patches/

FROM base AS deps
RUN npm ci --omit=dev
RUN npx prisma generate

FROM base AS build
RUN npm ci
COPY tsconfig.json ./
COPY src ./src/
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/prisma ./prisma
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/server.js"]
