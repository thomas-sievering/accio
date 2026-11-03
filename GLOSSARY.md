# accio

A personal app that runs coding agents (Claude Code first) across several of your own machines, and keeps each profile's agent use, such as work and personal, strictly apart.

## Machines

**Machine**:
One running accio server together with the computer, files and settings it controls.
_Avoid_: Environment, host, node

**Home machine**:
The single always-on machine, reachable from anywhere, that runs the hub, connects the other machines and clients, and holds the shared settings (profiles, skill sources, MCP servers).
_Avoid_: Master, primary, server, connector

**Pairing**:
Trusting a machine once so it can talk to the others and receive the shared settings. Unpairing removes that trust and its keys.
_Avoid_: Linking, registering

**Client**:
An app window you use to talk to machines. It holds no threads of its own.
_Avoid_: Frontend, desktop

## Profiles

**Profile**:
A named side of your life that agents run under, such as "personal" or "work". You choose which profiles exist. It has one or more accounts at each provider it uses, reaches them only through the hub, and never shares an account or traffic with another profile.
_Avoid_: Account, environment, identity

**Provider**:
A company whose models agents use, such as Anthropic or OpenAI.
_Avoid_: Vendor, backend

**Account**:
One login at a provider, such as a personal Anthropic account. It belongs to exactly one profile.
_Avoid_: Login, subscription, provider instance

**Hub**:
accio's proxy service on the home machine. It holds the accounts, keeps them signed in, and forwards each profile's agent requests only to that profile's accounts. When a profile has several accounts at one provider, the hub picks which one serves each new agent session.
_Avoid_: CLI proxy, accio proxy, gateway

**Sign-in**:
Adding an account to a profile: you approve accio on the provider's page and paste back the code it shows. The account is stored on the hub only.
_Avoid_: Login (as a verb or action), auth, connect

## Work

**Project**:
A repository, recognised across machines by its git remote URL. It belongs to exactly one profile.
_Avoid_: Workspace, repo (in UI text)

**Checkout**:
One machine's copy of a project's repository. A folder without a git remote is a project with a single checkout.
_Avoid_: Clone, project folder

**Thread**:
A durable conversation with an agent inside one checkout. It keeps the profile it started with for its whole life, but not any one account: a later turn may be served by another of that profile's accounts at the same provider.
_Avoid_: Chat, session, conversation

**Turn**:
One message from you and all the agent work that follows it until the agent stops.
_Avoid_: Run, request

**Interrupted**:
The state of a turn that stopped before finishing, because you stopped it or its machine restarted. It continues only when you resume it.
_Avoid_: Cancelled, failed (for this case)

## Skills

**Skill source**:
A git repository of skills that the home machine pulls and hands out, such as spellbook. A profile chooses which skill sources it gets.
_Avoid_: Skill pack, plugin
