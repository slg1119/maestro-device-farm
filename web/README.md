# maestro-device-farm web

React + Vite + TypeScript dashboard for farm-api. farm-api serves the build (`web/dist`) at `/`.

```bash
pnpm install
pnpm dev          # http://localhost:5173, proxies /api to FARM_API_URL (default http://localhost:8700)
pnpm test         # vitest (jsdom)
pnpm typecheck
pnpm build        # typecheck + build into web/dist
```

- API types: `src/api/types.ts` mirror the server's response models.
- Reads go through the hooks in `src/api/queries.ts`; `src/api/events.ts` subscribes to `/api/v1/events` (SSE) and
  invalidates the matching query keys.
- The API token and commit author live in this browser's localStorage (`src/lib/settings.ts`).
