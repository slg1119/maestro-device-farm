# Dashboard

For a first dashboard launch, use [Docker](../docs/guides/getting-started-docker.md) or the [native walkthrough](../docs/guides/getting-started-native.md). This page is for frontend contributors. Open Terminal on macOS or your terminal app on Linux in a cloned repository. [Node.js](https://nodejs.org/en/download) runs the development tools, and [pnpm](https://pnpm.io/installation) installs JavaScript packages. The API must be running before the dashboard can load farm data.


The React, TypeScript and Vite dashboard calls the farm API to manage devices, apps, Git workspaces, runs, artifacts, the flow editor and live Android screens. The production API serves the build from `web/dist` at `/`. Start with the [root README](../README.md) or the [annotated beginner guides](../docs/guides/getting-started-native.md).

## Develop

Start the API in another terminal, then run:

```sh
cd web
pnpm install --frozen-lockfile
pnpm dev
```

Open `http://localhost:5173/`. Vite proxies `/api` to `FARM_API_URL`, which defaults to `http://localhost:8700`. For a production build and checks:

```sh
pnpm test
pnpm typecheck
pnpm build
```

The API response types are mirrored in `src/api/types.ts`. Query hooks are in `src/api/queries.ts`, and `src/api/events.ts` listens to server-sent events to refresh the affected views. The browser stores an optional API token and editor commit author in its local storage; clear them in the dashboard settings when using a shared browser.

The UI walkthroughs show [new runs](../docs/guides/running-tests.md), [results](../docs/guides/reading-results.md), [workspaces](../docs/guides/workspaces-and-git.md), and the [editor](../docs/guides/flow-editor-and-ai.md).

## Recap and next step

`pnpm dev` serves the local development UI; `pnpm build` creates the bundle served by the API. **Next:** [Run tests](../docs/guides/running-tests.md) or [edit flows](../docs/guides/flow-editor-and-ai.md).
