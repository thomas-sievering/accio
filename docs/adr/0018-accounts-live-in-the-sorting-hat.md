# Accounts live in the Sorting Hat, a service separate from Accio

Provider accounts move out of the hub into the Sorting Hat, a service of its own (`apps/sorting-hat`). It signs accounts in and refreshes their credentials, groups them into houses, issues hat keys, forwards each model request to the account in use of the key's house, records usage, and reads limits. It knows nothing of Accio: no profiles, machines, threads or hubs. Apps such as pi (through pi-claude-bridge, which runs the real Claude Code) use it with a hat key exactly as Accio's threads do, and it runs without Accio. We split it so that one set of subscriptions serves every tool, and so that its usage and limits can be watched from a browser without an Accio client.

Accio uses the Sorting Hat; the dependency never points the other way. The hub holds an admin token for the Sorting Hat, pasted once from its dashboard and kept with the shared settings. Each profile links to one house, such as "personal" or "hrc"; making a profile offers to create a house of the same name or to pick an existing one. Choosing and ordering a profile's accounts in Accio sets that house's accounts, for every app that uses it, and signing an account in from Accio goes through the Sorting Hat's management API. A thread gets a hat key bound to its profile's house and one machine, created by the hub, plus the Sorting Hat's address. Unpairing a machine deletes its hat keys. Clients never hold the admin token.

The Sorting Hat runs at `sortinghat.mediatom.cc`, beside the hub at `accio.mediatom.cc`, so paired machines keep their hub address. Its dashboard (usage, limits, accounts, houses and hat keys) is behind Cloudflare Access; its model routes are not, and accept only hat keys. It lists each house's models in each provider's format, so other apps can discover them.

The Sorting Hat imports nothing from Accio's packages. It stays in this repository for now, with its own image, state and API description, so it can move to a repository of its own later.

This supersedes ADR 0002 and moves the account parts of ADRs 0007, 0010 and 0016 from the hub to the Sorting Hat: sign-in, credential storage and refresh, the Codex app-server used for accounts and models, and choosing the account in use, which now happens per house.

## Considered Options

- **Keep accounts in the hub and add keys for outside apps**: least work, but other apps would depend on Accio's hub running, and usage could only be seen in an Accio client.
- **Extract a library that the hub embeds**: separates the code but not the service; using it without Accio would need a second deployment with its own copy of the accounts.
- **Manage accounts only on the dashboard**: a simpler API, but profiles live in Accio, so choosing their accounts would mean leaving Accio.
- **A house created per profile and hub, such as "Accio · personal"**: keeps Accio's houses apart from other apps', but pi could not simply use the same accounts as the personal profile, and every hub would duplicate the same groups.
- **One hat key per profile, shared by all machines**: simpler, but a single machine could not be revoked (ADR 0002's reason for machine-bound keys).

## Consequences

The existing account state moves to the Sorting Hat once. Refresh tokens rotate, so the hub's copy is removed in the same step: two live copies would sign each other out. When the Sorting Hat is down, no thread can run; when only the hub is down, other apps keep working. Several apps and hubs can share a house: pi and Accio's personal profile both use "personal", and a Local dev hub can link to the same houses as Home server. They then share its accounts and order, and usage is told apart by hat key. Claude subscriptions remain usable only through the real Claude Code; the Sorting Hat swaps the key and changes nothing else, and the terms-of-service risk noted in ADR 0007 still applies to every app that uses it.
