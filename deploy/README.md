# Deploy

Infrastructure / environment templates that used to live under `docs/`.
These are operator-facing config, not documentation.

| File                                | Purpose                                                              |
| ----------------------------------- | -------------------------------------------------------------------- |
| `Dockerfile`                        | Multi-stage container build for the QTIP backend + frontend.         |
| `docker-compose.yml`                | Local / staging compose stack (app + MariaDB + nginx).               |
| `nginx.config.template`             | Production nginx vhost template (TLS, rate limiting, static SPA).    |
| `web.config.example`                | IIS rewrite rules for Windows-hosted deployments.                    |
| `production_environment_template.env` | Reference `.env` for prod — copy to `backend/.env` and fill in.    |

These files are templates. Do **not** copy a real `.env` here; runtime
secrets belong outside source control (see the root `.gitignore`).

For the deploy procedure itself see `scripts/deploy_application.ps1`
(`npm run deploy:prod`) and `scripts/deploy_database.ps1`
(`npm run db:deploy:prod`).
