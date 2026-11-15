# Sorting Hat HTTP API

The Sorting Hat holds provider accounts, groups them into **houses** and issues
**hat keys**. One HTTP server answers three kinds of request:

| Paths | Who may call | What |
| --- | --- | --- |
| `GET /healthz` | anyone | `{"ok":true}` while the server runs |
| `/api/...` | the admin token, or the dashboard | the management API below |
| `GET /`, `/dashboard/...` | the dashboard's visitor | the dashboard (README.md, "Dashboard") |
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
- **Usage**: the tokens a house's requests used, per hat key, account and model over time, as the Sorting Hat counted them.

## Authentication

### Admin token

The management API needs `Authorization: Bearer <admin token>`. The token is
created on first start and written to `<state dir>/admin-token` (readable only by
its owner), and printed once. Set `SORTING_HAT_ADMIN_TOKEN` to use another one
instead. Hat keys are never accepted here.

### The dashboard

Without the admin token, the management API answers the dashboard's own
calls: requests with `x-sorting-hat-dashboard: 1` that pass the dashboard's
check, and, for anything but `GET`, an `Origin` header equal to `Host`
(otherwise 403 `permission_error`). The dashboard's check is:

- with `SORTING_HAT_ACCESS_TEAM_DOMAIN` and `SORTING_HAT_ACCESS_AUD` set, a valid
  Cloudflare Access token in `Cf-Access-Jwt-Assertion` (or else the
  `CF_Authorization` cookie): RS256, signed by a key
  from `https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`, `iss` that
  address, `aud` containing the configured tag, not expired. Certs are cached
  for an hour and read again when a token names an unknown key (at most every 30 s);
- without them, a request from a loopback address with a loopback `Host`.

`GET /dashboard/session` tells the page which applies:
`{ "mode": "access" | "loopback", "email": string | null }`.

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
| 403 | `permission_error` | a dashboard change without the dashboard's own `Origin` |
| 404 | `not_found_error` | no such route, account, house, hat key or sign-in |
| 405 | `invalid_request_error` | the path exists but not with this method |
| 409 | `conflict_error` | the id is taken, an account is still in a house, a sign-in is already complete |
| 500 | `api_error` | something went wrong inside the Sorting Hat |

The model routes answer their own failures in Anthropic's error shape,
`{"type":"error","error":{"type":"authentication_error","message":"..."}}`, so
Claude Code and Codex show the message.

Bodies have a size limit (`bodies.ts`): 1 MiB for the management API, which
answers 400 above it, and 32 MiB for a model request, Anthropic's own limit for
messages, which answers 413 `request_too_large` above it and forwards nothing.

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
| `GET /api/houses/{id}/models` | | `{ openai: CodexModel[] }`, see below |

`CodexModel = { id, name, description, isDefault, efforts?: { id, description? }[], defaultEffort? }`
lists the models of the house's ChatGPT account in use, as its Codex app-server
reports them (empty without one), for an app that shows a model picker with
effort levels.

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

`signInRequired` means the provider ended the account's sign-in, for example by
refusing its refresh token; reading limits or forwarding a request finds it.
Houses skip such an account until it is signed in again, and it is read again
at most every five minutes in case the refusal passes.

| Method and path | Body | Answer |
| --- | --- | --- |
| `GET /api/limits` | | `Limits[]`, the last known for every account |
| `POST /api/limits/refresh` | `{ accountIds?: string[], force?: boolean }` | `Limits[]` after reading again |

Each account is read at most about every five minutes, and right after a shown
reset passes. Reading each account once a minute ran into Anthropic's 429s for
usage reads, so after a 429 the next read waits at least a minute (or longer, as
`Retry-After` says), and the five minutes double for each recent 429, up to 40,
halving again with each successful read. `force` reads at once, but never before
`retryAt`, nor within 5 seconds of the last attempt.

### Usage

The tokens model requests used, as the providers reported them, counted per hour,
hat key, house, account and model. Not the same as limits.

```
UsageReport = { from: string | null, to: string | null, bucket: "hour" | "day" | null,
                groupBy: Dimension[], rows: UsageRow[], totals: Totals }
UsageRow    = Totals & { start?, houseId?, hatKeyId?, accountId?, model?, providerId? }
Totals      = { requests, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens }
Dimension   = "house" | "hatKey" | "account" | "model" | "provider"
```

| Method and path | Answer |
| --- | --- |
| `GET /api/usage?from=&to=&groupBy=&bucket=&house=&hatKey=&account=&model=&provider=` | `UsageReport` |

- `from` and `to` are times; a bucket counts when it starts at or after `from`
  and before `to`. Either may be left out.
- `groupBy` splits the totals by any of the dimensions; repeat it or separate
  them with commas (`groupBy=house,model`). A row has a field only for each
  dimension it is grouped by. Without `groupBy`, there is one row.
- `bucket` (`hour` or `day`, in UTC) splits them by time as well; each row then
  has `start`. Rows are in order of `start`, then by most tokens.
- `house`, `hatKey`, `account`, `model` and `provider` keep only usage with
  that id. Usage recorded before hat keys has `hatKeyId: null`.
- `totals` sums every row.

What is counted:

- **Claude**: `POST /v1/messages`, from `message_start` and `message_delta` in
  a stream (the last value of each field) or `usage` in a whole reply.
  `inputTokens` is `input_tokens`, `cacheReadTokens` `cache_read_input_tokens`
  and `cacheWriteTokens` `cache_creation_input_tokens`.
- **ChatGPT**: `POST /openai/responses` and `/openai/responses/compact`, from
  the `response.completed` (or `response.failed`, `response.incomplete`) event
  in a stream, or `usage` in a whole answer. Its `input_tokens` counts cached
  input too, so `inputTokens` is `input_tokens` less
  `input_tokens_details.cached_tokens`, which is `cacheReadTokens`.
  `outputTokens` includes reasoning. ChatGPT reports no cache writes. The
  image tool's tokens, which it reports apart in `tool_usage.image_gen`, are
  added to `inputTokens` and `outputTokens`.
- **Images**: `POST /openai/images/generations` and `/openai/images/edits`, as
  the ChatGPT request that made the image, under the text model that called the
  image tool.
- The model is the one the provider reported, otherwise the one the request
  asked for. The account is the one whose credential sent the request that
  answered.
- Every answered request counts once in `requests`, also when the provider
  refused it or it was cut off; its tokens are whatever was reported until
  then, possibly none. A request resent with a refreshed token or the next
  account counts once. Reading the usage never holds back or changes what is
  forwarded.

Usage is kept in `<state dir>/usage.json`, written about 10 seconds after a
change and on shutdown, so a crash loses at most the last few seconds. Hours
older than 90 days are merged into days. A year of busy use (ten combinations of
hat key, account and model, each busy 16 hours a day) stays under 3 MB.
Usage stays after its hat key, house or account is deleted.

### Import

`POST /api/import` takes accounts, with their credentials, and houses as a
Sorting Hat keeps them in `sorting-hat.json`, such as an Accio hub moving its accounts here:

```
{ accounts: { id, name, providerId, account: ClaudeCredentials | null,
              openai?: { credentialId, email, planType, models } | null,
              codexAuth?: <the ChatGPT account's Codex auth.json> }[],
  houses:   { id, name, accountIds: string[] }[] }
```

It answers `{ accounts: Account[], houses: House[] }`. An account or house whose
id is already here is replaced, so the same import can be sent again; its hat
keys stay. Every house's `accountIds` must be accounts here or in the import.
The accounts' credentials become live here at once: the sender must never use
its copy again, since refresh tokens rotate.

## Model routes

With a hat key, the Sorting Hat swaps the key for the credential of the house's
account in use and forwards the request unchanged otherwise. It changes no
model, prompt or tool. The [image routes](#images) are the one exception: the
Sorting Hat answers them itself with a ChatGPT request of its own.

- **Anthropic**: any path other than those above, the [model lists](#models) and
  the dashboard (`/` and `/dashboard/`), such as `POST /v1/messages`
  and `POST /v1/messages/count_tokens`, goes to `https://api.anthropic.com` with
  the Claude account's OAuth token. Claude subscriptions may only be used through
  the real Claude Code, so point Claude Code (or a tool that runs it) here.
- **ChatGPT**: `POST /openai/responses` and `POST /openai/responses/compact` go
  to ChatGPT's Codex backend with the ChatGPT account's token and account id.
  Point Codex at `<sorting hat>/openai` with the Responses wire API.

A house without a signed-in account at the provider gets 401. If the provider
rejects a token, the Sorting Hat refreshes it once and resends.

### Models

The Sorting Hat answers these itself, with a hat key, listing the models of the
house's account in use at that provider. They are not forwarded, and only `GET`
is allowed.

| Path | Shape | Lists |
| --- | --- | --- |
| `GET /v1/models`, `GET /v1/models/{id}` | Anthropic's: `{ data: [{ type: "model", id, display_name, created_at, … }], has_more: false, first_id, last_id }` | the Claude account in use's models |
| `GET /openai/models`, `GET /openai/models/{id}` | OpenAI's: `{ object: "list", data: [{ id, object: "model", created: 0, owned_by: "openai" }] }` | the ChatGPT account in use's models |
| `GET /openai/v1/models`, `GET /openai/v1/models/{id}` | the same as `/openai/models` | for clients whose base address ends in `/v1` |

An OpenAI client with the base address `<sorting hat>/openai` (as Codex is set
up) asks `/openai/models`; one set up with `<sorting hat>/openai/v1` asks
`/openai/v1/models`. Codex itself does not ask for a list with a custom provider.
The whole list is one page; paging parameters are ignored. A house without a
signed-in account at the provider gets an empty list, and an unknown model 404.

- **Claude**: the Sorting Hat asks Anthropic's `GET /v1/models` with the
  account's OAuth token and the headers the model routes add (`anthropic-beta:
  oauth-2025-04-20`, plus `anthropic-version: 2023-06-01`), and passes on
  Anthropic's entries as they are. If Anthropic does not answer with a list, it
  lists Claude Code's stable aliases `opus`, `sonnet` and `haiku` instead (which
  Claude Code resolves itself), and asks again after 5 minutes. A list is kept
  per account for 6 hours, and read again when the account signs in again or
  out.
- **ChatGPT**: the account's model catalog, as its Codex app-server reports it:
  read at sign-in and again each time the Sorting Hat starts. `created` is 0,
  since ChatGPT reports no creation time.

### Images

OpenAI's Images API, answered with the house's ChatGPT account. ChatGPT's Codex
backend has no Images API of its own; images come from the `image_generation`
tool of its Responses API, as Codex makes them. So for each request the Sorting
Hat sends one `POST /responses` that has a text model of the account in use
call that tool exactly once with the prompt unchanged, reads the whole answer
and replies in the Images API's shape. The text model only passes the prompt on;
the image model is the same whichever calls it, so the Sorting Hat uses a small
one (a `luna`, `nano` or `mini` model if the account has one, else its default)
at its lowest effort.

| Method and path | Body | Answer |
| --- | --- | --- |
| `POST /openai/images/generations`, `POST /openai/v1/images/generations` | `{ prompt, size?, quality?, background?, output_format?, output_compression? }` | `ImagesResponse` |
| `POST /openai/images/edits`, `POST /openai/v1/images/edits` | the same, with `images: [{ image_url }]` (at least one) | `ImagesResponse` |

```
ImagesResponse = { created, data: [{ b64_json, revised_prompt? }], size?, quality?,
                   background?, output_format?, usage? }
```

- Bodies are JSON, as OpenAI's API takes for its GPT image models; multipart form
  data is refused. A reference image's `image_url` is a
  `data:image/…;base64,` or https URL; file ids are not supported. `image`,
  one such image or a list, is read the same as `images`. A generation may
  have reference images too.
- `model` is ignored. `n` may only be 1, `response_format` only `b64_json`;
  `mask` is refused. `quality` is `auto`, `low`, `medium` or `high`,
  `background` `auto`, `transparent` or `opaque`, `output_format` `png`
  (the default), `jpeg` or `webp`, and `size` `auto` or `WIDTHxHEIGHT`.
- ChatGPT treats `size` and `quality` as hints and may make another; the
  answer's `size` and `quality` are what it made. `background` it follows. `usage` is the image tool's, as ChatGPT reported it.
- They use the ChatGPT account's limits, as Codex's own images do. A house
  without a signed-in ChatGPT account gets 401, and a 401 or 429 from ChatGPT is
  handled as on the other ChatGPT routes. Any other refusal from ChatGPT is
  passed on as it came. When ChatGPT answers without an image, such as for a
  prompt it won't draw, the answer is 502 with
  `{ error: { type: "server_error", code: "image_generation_failed", message } }`,
  whose message holds what ChatGPT said. Other errors of these routes are in
  OpenAI's shape too: `{ error: { type, message, param, code } }`.
