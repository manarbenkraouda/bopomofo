# Deployment code

Local development is documented in [setup](setup/README.md). The files in `deploy/vps/` manage an existing Linux service installation. They are not a general-purpose installer for a new server.

## Service layout

- Next.js can run as a production Node/Bun process or on a supported frontend host. Set the public API address before the build.
- FastAPI runs behind a reverse proxy. Each API process needs the normal PostgreSQL role, Clerk settings, model files, and a persistent data directory.
- `bopomofo-api@.service` uses two ports, 8765 and 8766. One slot serves while the next release starts in the other slot.
- `bopomofo-deploy` stages releases, checks the new process, and changes the Caddy upstream. On a failed pre-switch check, the old slot keeps serving.
- The old process drains HTTP requests and background coach work before it closes the database pool. The service timeout allows for that drain.

Read `deploy/vps/install.sh`, `deploy/vps/bopomofo-deploy`, and `deploy/vps/deploy.env.example` before use. They include assumptions about system users, directories, Caddy, Git access, and GitHub deployment status reporting. Review them for your host.

## Changes that need care

- Database migrations must work while the old and new release overlap. Prefer additive migrations and back up the database before a schema change.
- Model weights and learner data stay outside release directories. Do not replace them during a code-only refactor.
- Do not use a production learner database for deployment tests. Configure a separate test database.
- Verify a signed-in request, a speech result, and in-progress background work after a service change. A successful build alone does not prove these behaviors.

This cleanup did not deploy, restart, or change the production service.
