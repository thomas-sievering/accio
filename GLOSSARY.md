# accio

A personal app that runs coding threads in harnesses such as Claude Code across several of your own machines, and keeps each profile, such as work and personal, strictly apart.

## Machines

**Machine**:
One running accio server together with the computer, files and settings it controls.
_Avoid_: Environment, host, node

**Hub**:
accio's single always-on service, reachable from anywhere, that every machine and client connects to. It holds the profiles, their accounts and the shared settings, forwards each profile's requests to that profile's accounts and no others, and relays messages between machines and clients. It is a service, not a machine: the computer that runs it may also be a machine.
_Avoid_: Home machine, accio hub, accio proxy, CLI proxy, gateway, master, connector

**Pairing**:
Trusting a machine or client once so it can reach the hub and receive the shared settings. Unpairing removes that trust and its keys.
_Avoid_: Linking, registering

**Client**:
An app window you use to talk to machines. It holds no threads of its own.
_Avoid_: Frontend, desktop

**Relay**:
The hub passing messages between a client and a machine, or between two machines, so you can read and drive a thread on any machine from anywhere. The thread stays on its own machine; nothing is copied.
_Avoid_: Sync (for threads), tunnel

**Shared settings**:
What the hub hands to every paired machine: the profiles, which project belongs to which profile, skill sources and MCP servers.
_Avoid_: Config, fleet

## Profiles

**Profile**:
A named side of your life that threads run under, such as "personal" or "work". You choose which profiles exist, and they are defined on the hub. It uses one or more providers and has one or more accounts at each, reaches them only through the hub, and never shares an account or traffic with another profile.
_Avoid_: Account, environment, identity

**Profile folder**:
A folder on a machine whose new projects default to a profile.
_Avoid_: Root

**Provider**:
A company whose models threads use, such as Anthropic or OpenAI.
_Avoid_: Vendor, backend, harness

**Harness**:
A coding program that runs a thread's turns, such as Claude Code, Codex or pi. Some harnesses can use several providers and models, such as pi; others only one provider's.
_Avoid_: Agent, runtime, coding tool, provider (as T3 Code uses it)

**Account**:
One login at a provider, such as a personal Anthropic account. It belongs to exactly one profile. An account at Anthropic is called a Claude account.
_Avoid_: Login, sign-in (as a noun for the account), subscription, provider instance

**Sign-in**:
Adding an account to a profile: you approve accio on the provider's page and paste back the code it shows. The account is stored on the hub only. Signing out removes an account from its profile.
_Avoid_: Login (as a verb or action), auth, connect

## Work

**Project**:
A repository, recognised across machines by its git remote URL. It belongs to exactly one profile, which can change only while the project has no threads.
_Avoid_: Workspace, repo (in UI text)

**Checkout**:
One machine's copy of a project's repository. A folder without a git remote is a project with a single checkout.
_Avoid_: Clone, project folder

**Thread**:
A durable conversation with a harness inside one checkout. It keeps the profile it started with for its whole life, but not any one account, provider or harness.
_Avoid_: Chat, session, agent, conversation

**Turn**:
One message from you and all the work that follows it until the thread stops and waits for you again. The hub picks which of the profile's accounts serves each turn, and may switch to another account, or to another provider when the harness can use several.
_Avoid_: Run, request

**Handoff**:
Moving a thread to another harness, such as from Claude Code to Codex. The new harness starts with a selection of the thread's history, and the thread shows where the handoff happened.
_Avoid_: Switch, transfer, migration

**Running**:
The state of a thread while a turn is in progress.

**Interrupted**:
The state of a turn that stopped before finishing, because you stopped it or its machine restarted. It continues only when you resume it.
_Avoid_: Cancelled, failed (for this case)

**Failed**:
The state of a thread whose last turn ended in an error. You can send it another message.
_Avoid_: Errored, crashed

**Snooze**:
Hiding a thread until a chosen time, when it comes back.
_Avoid_: Mute, defer

**Settle**:
Marking a thread as done. It stays readable and can be reopened.
_Avoid_: Archive, close, resolve

**Shelf**:
A group of threads in the sidebar apart from the open list: Working (running), Snoozed and Settled.
_Avoid_: Folder, inbox, tab

## Skills

**Skill source**:
A git repository of skills that the hub pulls and hands out, such as spellbook. A profile chooses which skill sources it gets.
_Avoid_: Skill pack, plugin
