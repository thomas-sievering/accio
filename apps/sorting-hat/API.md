# Sorting Hat HTTP API

The Sorting Hat holds provider accounts, groups them into **houses** and issues
**hat keys**. One HTTP server answers three kinds of request:

| Paths | Who may call | What |
| --- | --- | --- |
| `GET /healthz` | anyone | `{"ok":true}` while the server runs |
| `/api/...` | the admin token | the management API below |
| every other path | a hat key | model routes, forwarded to the house's account in use |

All bodies are JSON (`content-type: application/json`). Ids are opaque strings.
Times are ISO 8601 strings in UTC.

## Vocabulary

- **Account**: one login at a provider: `anthropic` (a Claude account) or `openai`
  (a ChatGPT account). It has a name and is signed in or out. Its credentials
  never leave the Sorting Hat.
- **House**: a named group of accounts, ordered per provider. An account may
  belong to several houses.
- **Account in use**: the account a house's next request at a provider uses,
  chosen among its signed-in accounts there: accounts with 5% or less left in any
  window are skipped until that window resets; of the rest, the one whose weekly
  or monthly allowance resets soonest is used; the house's order breaks ties and
  decides while no limits are known. When a provider answers 429, the Sorting
  Hat reads that account's limits again and, if the choice moves, resends the
  same request once with the next account.
- **Hat key**: what an app presents to send model requests through one house's
  accounts and nothing else. A house can have many; each can be renamed and
  revoked on its own.
- **Limits**: the allowance windows and reset times a provider reports for an account.

## Authentication

### Admin token

The management API needs `Authorization: Bearer <admin token>`. The token is
created on first start and written to `<state dir>/admin-token` (readable only by
its owner), and printed once. Set `SORTING_HAT_ADMIN_TOKEN` to use another one
instead. Hat keys are never accepted here.

### Hat keys

Model routes take a hat key as `Authorization: Bearer <hat key>` or
`x-api-key: <hat key>`. Its secret (`hat-...`) is returned once, when the key is
created; the Sorting Hat keeps only its SHA-256 hash and compares in constant
time. An unknown or revoked key, or one whose house was deleted, gets 401.

## Errors

Every refusal has an error body:

```json
{ "error": { "type": "invalid_request_error", "message": "A house name has 1 to 80 characters." } }
```

| Status | `type` | When |
| --- | --- | --- |
| 400 | `invalid_request_error` | the body or a value is not acceptable, or a sign-in failed |
| 401 | `authentication_error` | missing or wrong admin token or hat key |
| 404 | `not_found_error` | no such route, account, house, hat key or sign-in |
| 405 | `invalid_request_error` | the path exists but not with this method |
| 409 | `conflict_error` | the id is taken, an account is still in a house, a sign-in is already complete |
| 500 | `api_error` | something went wrong inside the Sorting Hat |

The model routes answer their own failures in Anthropic's error shape,
`{"type":"error","error":{"type":"authentication_error","message":"..."}}`, so
Claude Code and Codex show the message.

## Management API

Successful creates answer 201, deletes 204 with no body, everything else 200.

### Accounts

```
Account = { id, name, providerId: "anthropic" | "openai", signedIn: boolean,
            email: string | null, organization: string | null }
```

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/accounts` | | `Account[]` |
| `POST /api/accounts` | `{ name, providerId }` | `Account`, signed out |
| `GET /api/accounts/{id}` | | `Account` |
| `PATCH /api/accounts/{id}` | `{ name }` | `Account` |
| `DELETE /api/accounts/{id}` | | 204; 409 while a house has it |
| `POST /api/accounts/{id}/sign-out` | | `Account`; clears its credentials, keeps its name and houses |

### Sign-in

Signing an account in starts on the provider's page and finishes here.
Starting a new sign-in for an account cancels its earlier one. A sign-in that is
not finished within 15 minutes expires.

`POST /api/accounts/{id}/sign-in` starts one. For a Claude account the body may
be empty:

```json
{ "providerId": "anthropic", "signInId": "…", "url": "https://claude.ai/oauth/authorize?…" }
```

Open `url`, approve, and copy the code Anthropic's page shows (`code#state`).
Then `POST /api/sign-ins/{signInId}/complete` with `{ "code": "<pasted code>" }`
answers `{ "status": "complete", "account": Account }`. A full redirect address
is accepted as `code` too. An app that receives the code on its own machine may
pass `{ "redirectUri": "http://localhost:<port>/callback" }` when starting.

For a ChatGPT account, the body chooses the flow, `{ "flow": "browser" }`
(the default) or `{ "flow": "device" }`:

```json
{ "providerId": "openai", "signInId": "…", "url": "https://auth.openai.com/…", "userCode": "ABCD-1234" }
```

- **device**: open `url` (on any device), enter `userCode`, approve.
- **browser**: open `url` and approve. The browser then goes to
  `http://localhost:1455/auth/callback?code=…&state=…`, which usually does not
  exist where you are: copy that address and `POST /api/sign-ins/{signInId}/complete`
  with `{ "url": "<that address>" }` (or `{ "code", "state" }`). It answers
  `{ "status": "pending" }`.

Either way, poll `GET /api/sign-ins/{signInId}` until it answers
`{ "status": "complete", "account": Account }`. It stays `pending` until then,
and a failed sign-in answers 400 with the reason. For Claude it is `pending`
until completed with the code.

| Method and path | Body | Answer |
| --- | --- | --- |
| `POST /api/accounts/{id}/sign-in` | Claude: `{ redirectUri? }`; ChatGPT: `{ flow? }` | 201, see above |
| `POST /api/sign-ins/{signInId}/complete` | Claude: `{ code }`; ChatGPT browser: `{ url }` or `{ code, state }` | `{ status, account? }` |
| `GET /api/sign-ins/{signInId}` | | `{ status: "pending" }` or `{ status: "complete", account }` |
| `DELETE /api/sign-ins/{signInId}` | | 204; cancels it |

### Houses

```
House = { id, name,
          accounts: { anthropic: string[], openai: string[] },   // account ids, in order of use
          inUse:    { anthropic: string | null, openai: string | null } }
```

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/houses` | | `House[]` |
| `POST /api/houses` | `{ name, id?, accounts? }` | `House` |
| `GET /api/houses/{id}` | | `House` |
| `PATCH /api/houses/{id}` | `{ name }` | `House` |
| `PUT /api/houses/{id}/accounts` | `{ anthropic?: string[], openai?: string[] }` | `House` |
| `DELETE /api/houses/{id}` | | 204; deletes its hat keys too |
| `GET /api/houses/{id}/hat-keys` | | `HatKey[]` |

`id` defaults to one made from the name (`"Personal"` → `personal`, then
`personal-2`); when given it has 1 to 64 lowercase letters, digits, `-` or `_`.
It never changes. `accounts` sets each provider given, in that order; a provider
left out keeps its accounts. Every id must be an account at that provider.

### Hat keys

```
HatKey = { id, houseId, name, createdAt, revokedAt: string | null }
```

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/hat-keys?house={houseId}` | | `HatKey[]`; every house's without `house` |
| `POST /api/hat-keys` | `{ houseId, name }` | `HatKey & { secret }`, the only time `secret` is shown |
| `GET /api/hat-keys/{id}` | | `HatKey` |
| `PATCH /api/hat-keys/{id}` | `{ name }` | `HatKey` |
| `POST /api/hat-keys/{id}/revoke` | | `HatKey` with `revokedAt`; it gets 401 from now on |
| `DELETE /api/hat-keys/{id}` | | 204 |

A revoked key stays listed until it is deleted.

### Limits

```
Limits = { accountId, providerId,
           status: "idle" | "refreshing" | "ready" | "error" | "signedOut" | "unsupported",
           snapshot: { observedAt, windows: Window[] } | null,
           attemptedAt: string | null, retryAt: string | null,
           problem: { code: "signInRequired" | "rateLimited" | "unavailable", message } | null }
Window = { id, kind: "session" | "weekly" | "monthly" | "other", label,
           scope: string | null, usedPercent: number | null, resetsAt: string | null, durationMinutes: number | null }
```

Unknown values are `null`, never an invented zero. Houses that share an account
share one allowance.

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/limits` | | `Limits[]`, the last known for every account |
| `POST /api/limits/refresh` | `{ accountIds?: string[], force?: boolean }` | `Limits[]` after reading again |

Each account is read at most about once a minute unless `force` is set, and never
more than once every 5 seconds.

## Model routes

With a hat key, the Sorting Hat swaps the key for the credential of the house's
account in use and forwards the request unchanged otherwise. It changes no
model, prompt or tool.

- **Anthropic**: any path other than those above, such as `POST /v1/messages`
  and `POST /v1/messages/count_tokens`, goes to `https://api.anthropic.com` with
  the Claude account's OAuth token. Claude subscriptions may only be used through
  the real Claude Code, so point Claude Code (or a tool that runs it) here.
- **ChatGPT**: `POST /openai/responses` and `POST /openai/responses/compact` go
  to ChatGPT's Codex backend with the ChatGPT account's token and account id.
  Point Codex at `<sorting hat>/openai` with the Responses wire API.

A house without a signed-in account at the provider gets 401. If the provider
rejects a token, the Sorting Hat refreshes it once and resends.
