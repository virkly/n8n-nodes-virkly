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
| Passes the linter (`npm run lint`) | ✅ | CI (`ci.yml`) and the publish job run `npm run lint` |
| Tested locally (`npm run dev`) | ✅ | Unit tests on recorded fixtures (`test/`); node loaded in n8n during development |
| Scaffolded with the `n8n-node` CLI (recommended) | ✅ | `@n8n/node-cli` builds, lints and guards publishing (`prepublishOnly`) |

## Technical guidelines

| Requirement | Status | Where |
|---|---|---|
| One third-party service per package | ✅ | Only the virkly REST API (`https://virkly.io/v1`) |
| Not a duplicate of an existing node; no logic/flow-control node | ✅ | No virkly node exists in n8n; both nodes are service integrations |
| Trigger for the same service, programmatic style | ✅ | `nodes/VirklyTrigger` (polling, `poll()`) |
| No runtime dependencies | ✅ | `package.json` has only `devDependencies` and the `n8n-workflow` peer; `test/virkly.test.js` asserts it |
| No environment variable or file system access | ✅ | No `process.env` / `fs` in `nodes/` or `credentials/`; everything comes from parameters and the credential. The scanner checks this |
| TypeScript, n8n node conventions | ✅ | `nodes/**/*.ts`, `credentials/*.ts`, built by `n8n-node build` |
| Error handling and validation | ✅ | `NodeApiError` / `NodeOperationError` with readable messages for invalid key, quota, not found (README → Errors) |
| Passes `@n8n/scan-community-package` | ✅ | `npm run scan` (CI and publish job) runs the scanner on the `npm pack` tarball. 👤 After the first publish, also run `npx @n8n/scan-community-package n8n-nodes-virkly` against npm |
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
| Published from GitHub Actions with a provenance statement | ✅ | `.github/workflows/publish.yml`: on a `v*` tag, lint → build → test → scan → `npm publish --provenance --access public` |
| `@n8n/node-cli` ≥ 0.23.0 as devDependency | ✅ | `package.json` → `@n8n/node-cli: 0.56.4` |
| Tag matches the package version | ✅ | The publish job fails if the tag isn't `v<package.json version>` |
| Workflow proven without publishing | ✅ | Pull requests touching the workflow or `package.json` run the same job with `npm publish --dry-run` |
| npm trusted publisher (or `NPM_TOKEN` secret) | 👤 | npmjs.com → package → Settings → Trusted Publisher → GitHub Actions: owner `virkly`, repository `n8n-nodes-virkly`, workflow `publish.yml`, environment blank. A package must exist before it can have a trusted publisher; if npm won't allow that for the first publish, use a granular `NPM_TOKEN` repo secret once, then delete it |
| First publish | 👤 | `git tag v0.1.0 && git push origin v0.1.0` from main |

## Submission

| Requirement | Status | Where |
|---|---|---|
| Submit in the n8n Creator Portal (creators.n8n.io/nodes) | 👤 | After the first publish; review takes up to four weeks |
| Not competing with n8n paid/enterprise features | ✅ | Danish company data only |
