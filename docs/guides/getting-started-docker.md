# Getting started with Docker

**What you'll have at the end:** an API and English dashboard open at `http://localhost:8700/`. The agent and Android device come next.

## Copy-paste quick path

After [Docker](https://docs.docker.com/get-docker/) and [Git](https://git-scm.com/downloads) are installed, copy this repository's HTTPS URL from **Code** and replace `PASTE_REPOSITORY_URL`:

```sh
git clone PASTE_REPOSITORY_URL maestro-device-farm
cd maestro-device-farm
cp .env.example .env
docker compose up -d --build
```

Open `http://localhost:8700/`. The steps below explain each command.

## Before you begin

Use [Docker Desktop for macOS](https://docs.docker.com/desktop/setup/install/mac-install/), [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/), or [Docker Engine](https://docs.docker.com/engine/install/) with the [Compose plugin](https://docs.docker.com/compose/install/linux/) on Linux. Docker runs the API in a **container**, an isolated application environment. **Compose** reads `docker-compose.yml` and starts it. Open Terminal (macOS), PowerShell (Windows), or your terminal app (Linux). Paste one command and press Enter. An **agent** is the separate process that controls Android devices; this guide starts the API only.

## Install and start

### 1.1 Start Docker

On macOS or Windows, open **Docker Desktop**. On Linux, start your Docker service using your distribution's instructions. **You should see:** Docker Desktop says it is running, or the Linux service is active. **If it looks different:** finish the OS-specific installer above and restart the app.

### 1.2 Check Docker

In a terminal, run:

```sh
docker version
```

**You should see:** both of these headings:

```text
Client:
Server:
```

**If it looks different:** if `Server:` is absent, Docker is not running yet.

### 1.3 Check Compose

Run:

```sh
docker compose version
```

**You should see:** a version line beginning:

```text
Docker Compose version
```

**If it looks different:** install the Compose plugin or update Docker Desktop.

### 1.4 Copy the repository URL

On this repository's web page, click **Code > HTTPS > Copy**. **You should see:** the repository URL on your clipboard. **If it looks different:** use your Git host's HTTPS clone control.

### 1.5 Clone the repository

Replace `PASTE_REPOSITORY_URL` with that URL, then run:

```sh
git clone PASTE_REPOSITORY_URL maestro-device-farm
```

**You should see:** output containing:

```text
Cloning into 'maestro-device-farm'...
```

**If it looks different:** install [Git](https://git-scm.com/downloads) and reopen the terminal, or check repository access.

### 1.6 Enter the project folder

Run:

```sh
cd maestro-device-farm
```

**You should see:** no error; your terminal prompt may now end in `maestro-device-farm`. **If it looks different:** run the clone command from the same terminal, or locate the folder you cloned.

### 1.7 Copy local settings

Run:

```sh
cp .env.example .env
```

**You should see:** no output. **If it looks different:** confirm you are in the folder containing `.env.example`. The defaults are enough for the first launch.

### 1.8 Start the API

Run:

```sh
docker compose up -d --build
```

**You should see:** Compose build messages ending with the API container starting. **If it looks different:** check Docker's disk space and run `docker compose logs --tail=100 api`.

### 1.9 Check the container

Run:

```sh
docker compose ps
```

**You should see:** an `api` service with `healthy` in its status, for example:

```text
NAME                         SERVICE   STATUS
maestro-device-farm-api-1    api       Up (healthy)
```

**If it looks different:** wait a few seconds and retry. If it never becomes healthy, inspect `docker compose logs --tail=100 api`.

### 1.10 Open the dashboard

Open `http://localhost:8700/` in your browser. **You should see:** **Overview** in the sidebar and an agent status that may say **Agent not responding**.

![Docker dashboard after the API becomes healthy](../assets/docker-overview.png)

**Callouts:** (1) **Overview**; (2) **Agent not responding**; (3) **Available devices**.

**If it looks different:** check the container in step 1.9. If port 8700 is occupied, follow [Docker port settings](../docker.md#troubleshooting).

### 1.11 Check the API

Run:

```sh
curl http://localhost:8700/api/v1/healthz
```

**You should see:** JSON containing:

```text
"status":"ok"
```

**If it looks different:** use the same port that you opened in the browser and check `docker compose ps`.

## Recap

Your dashboard is running. The agent is optional until you connect an Android device. **Next:** [Connect a device](connect-a-device.md), then [write a flow](your-first-flow.md).

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| `docker` is not recognized | Docker is not installed or terminal PATH is stale | Install Docker and reopen the terminal |
| `Server:` is missing | Docker daemon is stopped | Start Docker Desktop or the Linux service |
| `api` never becomes healthy | Build or startup error | Run `docker compose logs --tail=100 api` |
| Browser cannot open port 8700 | API stopped or port is occupied | Check `docker compose ps`; see [Docker ports](../docker.md#troubleshooting) |
