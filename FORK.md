# 9Router Fork by hungtrinh203

This repository is a personal fork of [decolua/9router](https://github.com/decolua/9router), maintained for custom builds and deployments.

## Images

Release tags publish multi-platform images for `linux/amd64` and `linux/arm64`:

- Docker Hub: [`hungtrinh203/9router`](https://hub.docker.com/r/hungtrinh203/9router)
- GitHub Container Registry: [`ghcr.io/hungtrinhh/9router`](https://github.com/hungtrinhh/9router/pkgs/container/9router)

## Quick Start

Create a `.env` file from `.env.example` and replace the security-sensitive defaults:

```bash
cp .env.example .env
```

At minimum, set strong values for `JWT_SECRET`, `INITIAL_PASSWORD`, `API_KEY_SECRET`, and `MACHINE_ID_SALT`. Keep `DATA_DIR=/app/data` when running with Docker.

Start the application and the optional Headroom sidecar:

```bash
docker compose up -d
```

Open `http://localhost:20128`. Persistent application data is stored in the `9router-data` Docker volume.

Useful commands:

```bash
docker compose logs -f 9router
docker compose pull
docker compose up -d
docker compose down
```

## Build Locally

Build and run the image without pulling it from a registry:

```bash
docker build -t hungtrinh203/9router:local .
docker run --rm -p 20128:20128 --env-file .env \
  -v 9router-data:/app/data \
  hungtrinh203/9router:local
```

## Continuous Integration

The workflows under `.github/workflows/` provide:

- `ci.yml`: installs dependencies and verifies the production Next.js build on pushes and pull requests.
- `docker-publish.yml`: builds and pushes multi-platform Docker images when a `v*` tag is pushed or the workflow is run manually.

GitHub Container Registry uses the automatic `GITHUB_TOKEN`. Docker Hub publishing requires these repository secrets:

- `DOCKERHUB_USERNAME`: `hungtrinh203`
- `DOCKERHUB_TOKEN`: a Docker Hub access token with permission to push `hungtrinh203/9router`

## Release

Create and push a version tag that matches the version in `package.json`:

```bash
git tag v0.5.55
git push origin v0.5.55
```

The tag triggers the Docker workflow. The GitHub release can then be created with:

```bash
gh release create v0.5.55 --generate-notes --title "9Router v0.5.55"
```

## Upstream Sync

Add the upstream remote once, then merge upstream changes into this fork:

```bash
git remote add upstream https://github.com/decolua/9router.git
git fetch upstream
git merge upstream/master
```

Review and test upstream changes before pushing them to this fork.
