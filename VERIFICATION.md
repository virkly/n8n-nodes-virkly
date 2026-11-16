# n8n verification checklist

Maps every requirement in n8n's docs to where this repo meets it. Sources (checked 2026-11-16):
[Submit community nodes](https://docs.n8n.io/integrations/creating-nodes/deploy/submit-community-nodes/) and
[Verification guidelines](https://docs.n8n.io/integrations/creating-nodes/build/reference/verification-guidelines/).

✅ = met in this repo · 👤 = open human step (tracked in [virkly#1367](https://github.com/Dvinge-ApS/virkly/issues/1367))

## Package rules

| Requirement | Status | Where |
|---|---|---|
| Name starts with `n8n-nodes-` | ✅ | `package.json` → `name: n8n-nodes-virkly` |
| Keyword `n8n-community-node-package` | ✅ | `package.json` → `keywords` |
| Nodes and credentials listed under `n8n` | ✅ | `package.json` → `n8n.nodes`, `n8n.credentials` |
| Passes the linter (`npm run lint`) | ✅ | CI (`ci.yml`) and the `verify` job in `publish.yml` run `npm run lint` |
| Tested locally (`npm run dev`) | ✅ / 👤 | 43 unit tests on recorded fixtures (`test/`) run in CI. 👤 Before submitting, run `npm run dev`, add a Virkly API credential and run one Company → Get and the trigger's Fetch Test Event |
| Scaffolded with the `n8n-node` CLI (recommended) | ✅ | `@n8n/node-cli` builds and lints; its `prepublishOnly` blocks a manual `npm publish` from a checkout |

## Technical guidelines

| Requirement | Status | Where |
|---|---|---|
| One third-party service per package | ✅ | Only the virkly REST API (`https://virkly.io/v1`) |
| Not a duplicate of an existing node; no logic/flow-control node | ✅ | No virkly node exists in n8n; both nodes are service integrations |
| Trigger for the same service, programmatic style | ✅ | `nodes/VirklyTrigger` (polling, `poll()`) |
| No runtime dependencies | ✅ | `package.json` has only `devDependencies` and the `n8n-workflow` peer; `test/virkly.test.js` asserts it |
| No environment variable or file system access | ✅ | No `process.env` / `fs` in `nodes/` or `credentials/`; everything comes from parameters and the credential. The scanner checks this |
| TypeScript, n8n node conventions | ✅ | `nodes/**/*.ts`, `credentials/*.ts`, built by `n8n-node build` |
| Clear, consistent coding style | ✅ | Prettier config (`.prettierrc.js`) and n8n's ESLint rules (`npm run lint`) |
| Error handling and validation | ✅ | `NodeApiError` / `NodeOperationError` with readable messages for invalid key, quota, not found (README → Errors) |
| Passes `@n8n/scan-community-package` | ✅ / 👤 | `npm run scan` (CI and publish workflow) runs the same scanner on the `npm pack` tarball. 👤 n8n's command scans the published package: run `npx @n8n/scan-community-package n8n-nodes-virkly` after the first publish |
| English only (UI, errors, README) | ✅ | All parameter names, descriptions, errors and the README are English |
| Follows n8n's UX guidelines for nodes | ✅ | Enforced by the community-node lint rules (title case, descriptions, resource/operation structure); n8n reviews the rest |

## Package source verification

| Requirement | Status | Where |
|---|---|---|
| npm repository URL matches the GitHub repo | ✅ | `package.json` → `repository.url: https://github.com/virkly/n8n-nodes-virkly.git` |
| Git link on npm works; repo is public | ✅ | github.com/virkly/n8n-nodes-virkly is public |
| Author/maintainer matches between npm and the repo | 👤 | Publish from the `virkly` npm account/org so npm shows virkly as maintainer (`package.json` → `author: virkly`) |
| README with usage, example workflow and authentication | ✅ | `README.md` → Credentials, Operations, Trigger, "Example: customer goes bankrupt → Slack" |
| MIT licence | ✅ | `LICENSE.md`, `package.json` → `license: MIT` |

## Publishing and provenance

| Requirement | Status | Where |
|---|---|---|
| Published from GitHub Actions with a provenance statement | ✅ | `.github/workflows/publish.yml`: on a `v*` tag, job `verify` lints, builds, tests, scans and packs (read-only, no secrets); job `publish` publishes that tarball with `npm publish --provenance --access public` on a GitHub-hosted runner |
| `@n8n/node-cli` ≥ 0.23.0 as devDependency | ✅ | `package.json` → `@n8n/node-cli: 0.56.4` |
| Tag matches the package version | ✅ | `verify` fails if the tag isn't `v<package.json version>` or the tagged commit isn't on main |
| Workflow proven without publishing | ✅ / 👤 | Pull requests touching the workflow or `package.json` run `verify`, ending in `npm publish --dry-run` on the tarball. 👤 A dry run stops before the upload, so the `publish` job (npm upgrade, artifact download, npm auth, provenance attestation) first runs on the real tag push: watch that run and check the npm page shows "Built and signed on GitHub Actions" |
| First publish (npm auth) | 👤 | npm only lets you add a trusted publisher to a package that already exists, so the first publish uses a token: npmjs.com → Access Tokens → Generate New Token → Granular, packages "Read and write" for all packages (the package doesn't exist yet), 7-day expiry, bypass 2FA on. Save it as repo secret `NPM_TOKEN` (github.com/virkly/n8n-nodes-virkly → Settings → Secrets and variables → Actions). Then on main: `git tag v0.1.0 && git push origin v0.1.0` |
| Switch to trusted publishing | 👤 | After the first publish: npmjs.com → n8n-nodes-virkly → Settings → Trusted Publisher → GitHub Actions: owner `virkly`, repository `n8n-nodes-virkly`, workflow `publish.yml`, environment blank. Then set Publishing access to "Require two-factor authentication and disallow tokens", delete the `NPM_TOKEN` secret and revoke the token |

## Submission

| Requirement | Status | Where |
|---|---|---|
| Submit in the n8n Creator Portal (creators.n8n.io/nodes) | 👤 | After the first publish; review takes up to four weeks |
| Not competing with n8n paid/enterprise features | ✅ | Danish company data only |
