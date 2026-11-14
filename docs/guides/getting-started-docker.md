# Getting started with Docker

This guide gets the API and dashboard running. A real test also needs an Android device, an APK, flows, and an agent. The pictures come from an isolated demo with seeded data; no physical device was used for capture.

## 1. Install Docker and verify it

Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) on macOS or Windows, or Docker Engine plus the Compose plugin on Linux. Open a terminal and run:

```sh
docker version
docker compose version
```

You should see both a Client and Server version and a Compose version. The capture machine reported Docker `29.9.3` and Compose `v5.7.0`. If the Server line is missing, start Docker Desktop or the Docker daemon. The dashboard you will reach is shown below.

![A real Compose dashboard, with the overview heading marked](../assets/docker-overview.png)

## 2. Clone and set up the environment file

```sh
git clone <repository-url> maestro-device-farm
cd maestro-device-farm
cp .env.example .env
```

Replace `<repository-url>` with this project's published repository URL. Leave the commented defaults alone for a first launch. `.env` is ignored by Git; add `FARM_HOST_PORT=8710` and `FARM_PUBLIC_URL=http://localhost:8710` only if port 8700 is occupied. The image below shows the first page after these steps and startup.

![Dashboard overview from the running demo](../assets/overview.png)

## 3. Build and start

```sh
docker compose build
docker compose up -d
docker compose ps
```

You should see `api` in the service list. On the verified build, Compose reported `Image public-release-api Built`, then the API container became `healthy`. The agent is an optional profile and stays stopped until you deliberately connect adb.

![Overview in the running API container](../assets/docker-overview.png)

## 4. Open the dashboard

Visit `http://localhost:8700/` (or your chosen host port). Confirm that `curl http://localhost:8700/api/v1/healthz` returns JSON containing `"status":"ok"`. The footer will say the agent is not responding until you enable one.

![Overview page and first navigation target](../assets/docker-overview.png)

## 5. Prepare a first run

Follow [Connect a device](connect-a-device.md), [Your first flow](your-first-flow.md), and [Running tests](running-tests.md). Upload an Android APK for the flow's package before submitting. The GIF shows the demo dashboard navigation; the demo run submission itself is shown in the running-tests guide.

![Opening the run area in the Compose dashboard](../assets/getting-started-docker.gif)

*The GIF opens the run area from the Compose dashboard. Its API has no agent or devices until you connect them.*

For adb networking, backup, upgrades, and the optional agent profile, read [Docker operations](../docker.md).
