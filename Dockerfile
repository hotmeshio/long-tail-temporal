# Long Tail with Temporal as the durable engine.
# Installs @hotmeshio/long-tail from vendor/*.tgz when present (scripts/pack-long-tail.sh), else from npm.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ARG LONG_TAIL_SPEC=@hotmeshio/long-tail@^0.36.0
ARG TEMPORAL_VERSION=1.25.0
COPY vendor/ ./vendor/
RUN npm init -y >/dev/null \
 && LT="$(ls ./vendor/*.tgz 2>/dev/null | head -1 || true)" \
 && npm install --omit=dev --no-audit --no-fund "${LT:-$LONG_TAIL_SPEC}" \
      "@temporalio/client@${TEMPORAL_VERSION}" "@temporalio/common@${TEMPORAL_VERSION}" "@temporalio/proto@${TEMPORAL_VERSION}"

FROM deps AS builder
ARG TEMPORAL_VERSION=1.25.0
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm install --no-save --no-audit --no-fund typescript@5 @types/node@22 "@temporalio/workflow@${TEMPORAL_VERSION}" \
 && npx tsc -p tsconfig.build.json

# The example worker: reviewOrder plus the Long Tail activities.
FROM ${NODE_IMAGE} AS example
WORKDIR /app
ARG TEMPORAL_VERSION=1.25.0
RUN npm init -y >/dev/null && npm install --no-audit --no-fund tsx@4 \
      "@temporalio/worker@${TEMPORAL_VERSION}" "@temporalio/workflow@${TEMPORAL_VERSION}" "@temporalio/client@${TEMPORAL_VERSION}" \
      "@temporalio/common@${TEMPORAL_VERSION}" "@temporalio/proto@${TEMPORAL_VERSION}"
COPY package.json ./node_modules/@hotmeshio/long-tail-temporal/package.json
COPY --from=builder /app/build ./node_modules/@hotmeshio/long-tail-temporal/build
COPY examples ./examples
CMD ["npx", "tsx", "examples/review-order/worker.ts"]

FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/build ./build
EXPOSE 3000
CMD ["node", "build/start.js"]
