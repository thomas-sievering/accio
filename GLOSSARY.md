# accio

A personal app that runs coding threads in harnesses such as Claude Code across several of your own machines, and keeps each profile, such as work and personal, strictly apart.

## Machines

**Machine**:
One running accio server together with the computer, files and settings it controls.
_Avoid_: Environment, host, node

**Hub**:
accio's single always-on service, reachable from anywhere, that every machine and client connects to. It holds the profiles, their accounts and the shared settings, knows which machines are paired and which are connected right now, forwards each profile's requests to that profile's accounts and no others, and relays messages between machines and clients. It is a service, not a machine: the computer that runs it may also be a machine.
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
Everything the hub stores and hands to every paired machine, so that you change it once from any client: the profiles with their providers and accounts, which project belongs to which profile, the harnesses, skill sources, MCP servers, and each machine's profile folders. A few of them apply to one machine only, such as its profile folders, but they are still stored on the hub. A client keeps only its own look and feel, such as the theme.
_Avoid_: Config, fleet, machine settings (for settings stored on the hub)

## Profiles

**Profile**:
A named side of your life that threads run under, such as "personal" or "work". You choose which profiles exist, and they are defined on the hub. It selects named accounts configured separately on the hub and reaches only those accounts through the hub. An account may be selected by several profiles. Currently each profile selects one Claude account and one ChatGPT account independently.
_Avoid_: Account, environment, identity

**Profile folder**:
A folder on one machine whose new projects default to a profile. Each machine has its own, since paths differ between machines, but the hub stores them with the other shared settings.
_Avoid_: Root

**Provider**:
A company whose models threads use, such as Anthropic or OpenAI.
_Avoid_: Vendor, backend, harness

**Harness**:
A coding program that runs a thread's turns, such as Claude Code, Codex or pi. Some harnesses can use several providers and models, such as pi; others only one provider's. Which harnesses exist and which providers each can use is a shared setting; each machine reports which harnesses it has installed.
_Avoid_: Agent, runtime, coding tool, provider (as T3 Code uses it)

**Effort**:
How hard a model thinks before it answers, such as low, medium or high. Each model accepts its own levels, as its harness reports them. A thread keeps its effort with its model and uses it on every turn until you change it.
_Avoid_: Thinking level, reasoning effort, thinking budget

**Accio tools**:
Tools accio gives every harness, such as offer_choice. Each machine serves them to its own harnesses over MCP, under the name `accio`; each turn may use them only while it runs.
_Avoid_: Accio MCP, custom tools, plugins

**System prompt**:
What accio adds to a harness's own instructions for every turn: titled sections that describe accio's chat, such as how to show images inline. Each harness receives it in its own way. Claude Code gets it after its built-in system prompt and Codex as developer instructions. It is read-only and shown under Settings → System prompt.
_Avoid_: Instructions, preamble, custom prompt

**Account**:
One login at a provider, such as a personal Anthropic account. It has a custom name, is set up independently, and can be selected by profiles. An account at Anthropic is called a Claude account; an account at OpenAI is called a ChatGPT account.
_Avoid_: Login, sign-in (as a noun for the account), subscription, provider instance

**Sign-in**:
Signing an account in on the provider's page. Claude shows a code to paste back into accio; ChatGPT asks you to enter the device code accio displays. The account is stored on the hub only. Signing out clears its credentials while preserving its name and profile selections.
_Avoid_: Login (as a verb or action), auth, connect

## Work

**Project**:
A repository, recognised across machines by its git remote URL. It belongs to exactly one profile, which can change only while the project has no threads.
_Avoid_: Workspace, repo (in UI text)

**Checkout**:
One machine's copy of a project's repository. A folder without a git remote is a project with a single checkout.
_Avoid_: Clone, project folder

**Thread**:
A durable conversation with a harness inside one checkout. It exists from its first message on. It keeps the profile it started with for its whole life, but not any one account, provider or harness.
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

**Choice**:
Two or more screenshots a harness shows side by side, through the offer_choice accio tool, when you ask it to prototype, try or mock up UI for a feature. You pick one in your next message and add feedback if you like; the harness reads the pick on the message's first line.
_Avoid_: Board, gallery, poll, variants (for the whole set)

**Snooze**:
Hiding a thread until a chosen time, when it comes back.
_Avoid_: Mute, defer

**Settle**:
Marking a thread as done. It stays readable and can be reopened.
_Avoid_: Archive, close, resolve

**Shelf**:
A group of threads in the sidebar apart from the open list: Working (a turn is running), Snoozed and Settled.
_Avoid_: Folder, inbox, tab

## Skills

**Skill source**:
A git repository of skills that the hub pulls and hands out, such as spellbook. A profile chooses which skill sources it gets.
_Avoid_: Skill pack, plugin
