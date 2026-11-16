# n8n-nodes-virkly

An [n8n](https://n8n.io) community node for [virkly](https://virkly.io): Danish company data from the CVR register.

## Installation

In n8n, go to **Settings → Community Nodes → Install**, enter `n8n-nodes-virkly` and confirm.
See n8n's [community nodes guide](https://docs.n8n.io/integrations/community-nodes/installation/) for self-hosted setups.

## Credentials

1. Sign up at [virkly.io](https://virkly.io) (the Free plan includes API access) and create an API key under
   [Dashboard → Settings → API keys](https://virkly.io/dashboard/settings/api-keys). Keys start with `vkly_live_`.
2. In n8n, create a **Virkly API** credential and paste the key.
3. Save: n8n tests the key with one company lookup (it counts as one API call) and tells you if virkly doesn't
   accept it.

## Operations

### Company → Get

Looks up a company by its CVR number (8 digits; spaces and dashes are ignored, so `2425 6790` works) and
returns the company as JSON: name, status, address, industry, employees, production units and more.

Errors you can act on:

- **No company with CVR …**: the number is valid but no company has it.
- **virkly rejected the API key**: check the credential.
- **Quota reached**: your plan's monthly calls are used up. The error links to [pricing](https://virkly.io/pricing)
  so you can upgrade and keep the workflow running.

Every call counts as one API call on your plan.

## Development

```bash
npm install
npm run build
npm test      # (after build) unit tests on request building and response mapping (recorded fixtures, no network)
npm run lint  # n8n's community-node linter
npm run scan  # n8n's community-package scanner on the npm pack tarball
```

## License

[MIT](LICENSE.md)
