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

Example: CVR `24256790` returns NOVO NORDISK A/S.

### Company → Get Financials

Key figures from the company's annual reports (revenue, gross profit, operating profit, net profit, equity, total
assets and ratios), newest year first, as one item. Set **Options → Year** for a single fiscal year. Only companies
that publish annual reports (ApS, A/S, …) have figures.

Example: CVR `24256790` returns `latestFinancials.year` 2025 and `historicalData` for the earlier years.

### Company → Search

Searches companies by name or CVR (**Query**), or lists a segment when you leave the query empty and set at least
one filter: **Municipality** (kommune), **Founded From**, **Founded To**. **Status** narrows to active or dissolved
companies. Returns one item per company. Every result has `reklamebeskyttet`: Danish marketing law forbids
unsolicited marketing to companies where it is `true` (segment lists leave them out).

Example: Query empty, Municipality `Aarhus`, Founded From `2026-11-01` lists companies founded in Aarhus since then.

### Bankruptcy → Get Many

Companies declared bankrupt in the last 7 or 30 days (**Period**), newest first, one item per company with
`cvr`, `name`, `municipality`, `industryCode` and `bankruptAt`. **Filters → Industry Code** limits it to one trade.

Example: Period `Last 7 Days`, Return All on, then an IF node on `municipality` posts local bankruptcies to Slack.

### Person → Get

A person's roles in companies (director, board, owner, founder) by their **enhedsNummer**, the participant
number in the CVR register (the number at the end of a person page URL on virkly.io).

Example: open a person page on virkly.io, copy the number at the end of its URL, and Person → Get returns the
person's name and `roles`.

### Paging and API calls

Search and Get Many return up to **Limit** results, or everything with **Return All**. Every call to virkly counts
as one API call on your plan, and Return All fetches page after page: 100 companies or 50 bankruptcies per call.
Search stops at 10,000 results; narrow a bigger segment with the founding dates. When a page hits your plan's
per-minute limit (10 calls a minute on Free), the node waits as long as virkly asks (at most a minute) and retries.

### Errors

Every operation fails the same way: a rejected API key, **not found** (CVR or enhedsNummer), or a used-up quota
with the [pricing](https://virkly.io/pricing) link. Turn on n8n's **Continue On Fail** to keep going and get the
error on the item instead.

The node returns exactly what the API returns at the time of the call; it caches nothing.

## Trigger

### Virkly Trigger → Company Changed / Company Went Bankrupt

Starts the workflow for each new change in virkly's change feed (`/v1/changes`), one item per change with the
feed's fields: `cvr`, `name`, `type` (`status` or `name`), `oldValue`, `newValue`, `description`, `changedAt`,
`recordedAt` and, for status changes, `statusDetail`.

- **Event**: *Company Changed* (pick the change types: status, name) or *Company Went Bankrupt*: status changes to
  `UNDER KONKURS`.
- **CVR Numbers**: only these companies, separated by commas or new lines. Leave empty for every company.
- **First activation** starts from "now", so you never get a flood of old changes. After that the trigger remembers
  where it stopped and each change arrives exactly once, also after a pause. Free and Pocket keys read the last 7
  days: after a longer pause the trigger picks up from 7 days back and skips anything older.
- **Fetch Test Event** returns the latest matching change from the last 7 days, or says there is none yet.
- **API calls**: the CVR register updates once a day, so the trigger asks virkly at most once an hour, whatever the
  poll time is set to. That is about 720 calls a month, inside the Free plan's 1,000. On busy days a check can take
  a few more calls (500 changes per call).

### Example: customer goes bankrupt → Slack

1. Add **Virkly Trigger**, choose *Company Went Bankrupt* and paste your customers' CVR numbers (export them from
   your accounting system).
2. Add a **Slack** node → *Send Message* to your credit-control channel, with the text
   `{{ $json.name }} (CVR {{ $json.cvr }}) er gået konkurs: https://virkly.io/company/{{ $json.cvr }}`.
3. Activate the workflow. When one of those customers is declared bankrupt, the message arrives within a few hours
   of virkly's daily register update.

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
