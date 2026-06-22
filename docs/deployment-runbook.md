# Ritwal Precompro Agentic API Deployment Runbook

## Source Of Truth

- Local repo: this project on the Mac.
- Remote repo: `https://github.com/grupomistico/ritwal-precompro-agentic-api`.
- Dokploy source: GitHub HTTPS URL `https://github.com/grupomistico/ritwal-precompro-agentic-api.git`.
- Branch: `main`.
- Build: Nixpacks.
- Public API: `https://ritwal-precompro-api.grupomistico.cloud`.

## Deploy Flow

1. Commit changes locally.
2. Run `npm run deploy:dokploy`.
3. The script runs tests, requires a clean working tree, pushes `main` to GitHub, and asks Dokploy to deploy from GitHub.

## VPS Access

SSH uses the `deploy` user with key auth:

```sh
ssh -i ~/.ssh/ritwal_grupomistico_ed25519 deploy@2.24.77.242
```

Root SSH and password auth should remain disabled.

## Security Baseline

- UFW should allow only `22/tcp`, `80/tcp`, and `443/tcp`.
- Dokploy panel is exposed through HTTPS at `https://grupomistico.cloud`.
- Direct external access to Dokploy's Docker-published `3000/tcp` is blocked by `ritwal-firewall.service`.
- Temporary internal Git services on `8088`, `8089`, and `9418` should remain removed or disabled.
- Runtime secrets live in Dokploy environment variables and local `.env`; they must not be committed.

## Smoke Tests

```sh
curl https://ritwal-precompro-api.grupomistico.cloud/health
```

Authenticated tool checks require `TOOL_SECRET`:

```sh
curl -H "x-tool-secret: $TOOL_SECRET" \
  https://ritwal-precompro-api.grupomistico.cloud/tools/schema
```
