# accio

A personal app that runs coding threads in harnesses such as Claude Code across several of your own machines, and keeps each profile, such as work and personal, strictly apart.

## Machines

**Machine**:
One running accio server together with the computer, files and settings it controls.
_Avoid_: Environment, host, node

**Hub**:
An independent service that holds profiles, provider accounts and shared settings, trusts paired machines, and forwards their model requests to the selected accounts. A machine can save several hubs, such as Home server and Local dev; each client window selects one. Hubs have separate state and durable identities. The general thread relay is future work.
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
A coding program that runs a thread's turns. Accio currently supports Claude Code with Anthropic and Codex with OpenAI. Each machine reports which harnesses it has installed.
_Avoid_: Agent, runtime, coding tool, provider (as T3 Code uses it)

**Effort**:
How hard a model thinks before it answers, such as low, medium or high. Each model accepts its own levels, as its harness reports them. A thread keeps its effort with its model and uses it on every turn until you change it.
_Avoid_: Thinking level, reasoning effort, thinking budget

**Accio tools**:
Tools accio gives every harness, such as offer_choice. Each machine serves them to its own harnesses over MCP, under the name `accio`; each turn may use them only while it runs.
_Avoid_: Accio MCP, custom tools, plugins

**Built-in tools**:
A harness's own tools, such as Claude Code's WebSearch or Codex's goals, grouped into switches under Settings → Harnesses. The switches are shared settings for the whole hub. By default only a shell and file reading and editing are on; other capabilities come as accio tools that work the same on every harness. Changes apply from each thread's next turn.
_Avoid_: Default tools, native tools, harness tools

**System prompt**:
What accio adds to a harness's own instructions for every turn: titled sections that describe accio's chat, such as how to show images inline. Each harness receives it in its own way. Claude Code gets it after its built-in system prompt and Codex as developer instructions. It is read-only and shown under Settings → System prompt.
_Avoid_: Instructions, preamble, custom prompt

**Account**:
One login at a provider, such as a personal Anthropic account. It has a custom name, is set up independently, and can be selected by profiles. An account at Anthropic is called a Claude account; an account at OpenAI is called a ChatGPT account.
_Avoid_: Login, sign-in (as a noun for the account), subscription, provider instance

**Sign-in**:
Signing an account in on the provider's page. Claude and ChatGPT finish automatically after browser approval, using a short-lived callback on the browser's PC. Provider credentials remain on the initiating hub. Signing out clears its credentials while preserving its name and profile selections.
_Avoid_: Login (as a verb or action), auth, connect

## Work

**Project**:
A repository, recognised across machines by its git remote URL. It belongs to exactly one profile, which can change only while the project has no threads.
_Avoid_: Workspace, repo (in UI text)

**Checkout**:
One machine's copy of a project's repository. A folder without a git remote is a project with a single checkout.
_Avoid_: Clone, project folder

**Owned worktree**:
A separate Git working copy and branch allocated to one thread. New threads in committed Git projects work here; existing threads, ordinary folders and empty repositories keep their original directories. Ownership lasts until Archive releases it. Process management currently covers Accio's preview runner; this is not complete process isolation.
_Avoid_: Sandbox, project (for the thread's working copy)

**Thread**:
A durable conversation with a harness, optionally attached to a project's checkout and owned worktree. It exists from its first message on. It keeps its starting hub, profile and harness; its model can change within that harness. Accounts follow the profile's current selections. A No project thread runs under a profile without a project checkout.
_Avoid_: Chat, session, agent, conversation

**Turn**:
Work by the harness until it finishes or is interrupted, started by a user message, Resume or a delivery request. Each turn uses the profile's selected account for that harness's provider. Steering can add messages during the same turn.
_Avoid_: Run, request

**Queued message**:
A message saved to start a later turn after the current turn finishes. It can be edited, removed or sent as steering while the harness accepts input.

**Steering**:
Sending a message to the harness during its current turn, without interrupting it or starting a separate turn.

**Handoff**:
Planned capability to move a thread to another harness with selected history. Currently changing harnesses requires a new thread.
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

**Goal**:
What a thread keeps working toward across turns, set with `/goal <objective>`. accio starts each next turn itself until the harness reports it achieved or blocked through the finish_goal accio tool, or a turn stops, fails or uses no tools. There is no turn limit, as in Claude Code and Codex; a bar above the composer shows it with pause, resume and clear. It works the same on every harness; no harness's own goal feature is used.
_Avoid_: Task, objective (for the whole thing), loop

**Snooze**:
Hiding a thread until a chosen time, when it comes back.
_Avoid_: Mute, defer

**Settle**:
Marking a thread as done in the sidebar, by hand or automatically once its delivery is verified. It stays readable and can be reopened; its owned worktree and processes remain allocated.
_Avoid_: Archive, close, resolve

**Ship**:
Requesting delivery from the owning thread: finish the work, integrate the target branch, verify and publish under the project's direct or pull-request policy. A request made during work waits for that turn to finish. It authorizes publication under its recorded policy.

**Delivery policy**:
A project's choice of how Ship publishes: directly onto the target branch, or through a pull request. It applies to new requests; an existing request keeps the policy it was recorded with.
_Avoid_: Merge mode, strategy

**Prepare for review**:
Requesting preparation and verification of a pull request without authorizing its merge. The owned worktree stays available for review fixes.

**Archive**:
Releasing a delivered thread's owned worktree and branch after checking its published revision, preserving unpublished work and stopping its owned preview. Conversation history remains, the thread is settled, and a follow-up allocates a fresh worktree. See the [delivery notes](docs/plans/thread-delivery.md) for eligibility and recovery.
_Avoid_: Settle, delete (for releasing execution resources)

**Owned preview**:
The app a thread's harness starts from its owned worktree through the project's preview command, on its own port, opened by the **Open app** button. Accio stops it on Archive or shutdown. Processes started any other way are not previews.
_Avoid_: Dev server, sandbox

**Shelf**:
A group of threads in the sidebar apart from the open list: Working (a turn is running), Snoozed and Settled.
_Avoid_: Folder, inbox, tab

## Secrets and limits

**Secret**:
A named token a thread can request through the `request_secret` accio tool. Values stay write-only on the hub, encrypted, and reach the harness only as a temporary file for one turn.
_Avoid_: Credential (for the hub's provider tokens), key, password

**Save & use**:
Answering a secret request by keeping the value on the hub for the current profile, project and purpose, so later requests for that purpose are answered automatically.

**Use once**:
Answering a secret request for the current turn only; nothing is stored.

**Limits**:
The allowance windows and reset times a provider reports for an account, read by the hub with the account's own credentials. Profiles that select the same account share one allowance. Shown from the sidebar, the composer indicator and account settings.
_Avoid_: Quota, usage, rate limit (in UI text)

**Hub connection**:
A machine's saved record of one hub: its name, URL and server-only credential, with its own local workspace under `hubs/<hub-id>`. A window selects one connection at a time.
_Avoid_: Server (in UI text), endpoint

## Skills

**Skill source**:
A git repository of skills that the hub pulls and hands out, such as spellbook. Individual skills can be enabled globally, for profiles or for projects, or kept optional in the library. Copying one into a project creates independent files owned by that project's Git history.
_Avoid_: Skill pack, plugin
