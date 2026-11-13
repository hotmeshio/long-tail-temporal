# Long Tail with Temporal as the durable engine.
ARG NODE_IMAGE=node:22-bookworm-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ARG LONG_TAIL_SPEC=@hotmeshio/long-tail@^0.36.1
ARG TEMPORAL_VERSION=1.25.0
RUN npm init -y >/dev/null \
 && npm install --omit=dev --no-audit --no-fund "${LONG_TAIL_SPEC}" \
      "@temporalio/client@${TEMPORAL_VERSION}" "@temporalio/common@${TEMPORAL_VERSION}" "@temporalio/proto@${TEMPORAL_VERSION}"

FROM deps AS builder
ARG TEMPORAL_VERSION=1.25.0
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm install --no-save --no-audit --no-fund typescript@5 @types/node@22 "@temporalio/workflow@${TEMPORAL_VERSION}" \
 && npx tsc -p tsconfig.build.json

# The example workers: the review and machine line workflows plus the Long Tail activities.
FROM deps AS example
ARG TEMPORAL_VERSION=1.25.0
RUN npm install --no-save --no-audit --no-fund tsx@4 \
      "@temporalio/worker@${TEMPORAL_VERSION}" "@temporalio/workflow@${TEMPORAL_VERSION}"
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
