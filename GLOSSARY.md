# accio

A personal app that runs coding agents (Claude Code first) across several of your own machines, and keeps work and personal agent use strictly apart.

## Machines

**Machine**:
One running accio server together with the computer, files and settings it controls.
_Avoid_: Environment, host, node

**Home machine**:
The single always-on machine, reachable from anywhere, that runs the hub, connects the other machines and clients, and holds the shared settings (accounts, skill sources, MCP servers).
_Avoid_: Master, primary, server, connector

**Pairing**:
Trusting a machine once so it can talk to the others and receive the shared settings. Unpairing removes that trust and its keys.
_Avoid_: Linking, registering

**Client**:
An app window you use to talk to machines. It holds no threads of its own.
_Avoid_: Frontend, desktop

## Accounts

**Account**:
A named identity that agents run under, such as "personal" or "hrc". Each account reaches the model provider only through its own hub proxy.
_Avoid_: Profile, provider instance, login

**Job account**:
An account that belongs to an employer. Its traffic never shares a proxy or login with any other account.
_Avoid_: Work profile

**Hub**:
The proxy service that holds the actual provider logins and forwards agent requests for each account.
_Avoid_: CLI proxy, gateway

## Work

**Project**:
A repository, recognised across machines by its git remote URL. It belongs to exactly one account.
_Avoid_: Workspace, repo (in UI text)

**Checkout**:
One machine's copy of a project's repository. A folder without a git remote is a project with a single checkout.
_Avoid_: Clone, project folder

**Thread**:
A durable conversation with an agent inside one checkout. It keeps the account it started with for its whole life.
_Avoid_: Chat, session, conversation

**Turn**:
One message from you and all the agent work that follows it until the agent stops.
_Avoid_: Run, request

**Interrupted**:
The state of a turn that stopped before finishing, because you stopped it or its machine restarted. It continues only when you resume it.
_Avoid_: Cancelled, failed (for this case)

## Skills

**Skill source**:
A git repository of skills that the home machine pulls and hands out, such as spellbook. An account chooses which skill sources it gets.
_Avoid_: Skill pack, plugin
