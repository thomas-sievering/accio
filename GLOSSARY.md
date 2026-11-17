# accio

A personal app that runs coding threads in harnesses such as Claude Code across several of your own machines, and keeps each profile, such as work and personal, strictly apart.

## Hub, machines and roles

**Machine**:
A connected computer, together with its files and settings. It can run a client, a worker, or both. Being connected does not mean it can run turns; that requires a worker. The Machines list shows only machines with a worker, since its name, harnesses, tools and profile folders all belong to the worker. A client-only device, such as a phone or a browser on any computer, is not listed as a machine; once clients pair directly, it will appear as a paired client that can be unpaired.
_Avoid_: Environment, host, node

**Hub**:
The service that connects clients and workers, holds profiles and shared settings, and trusts paired machines and clients. It holds no accounts: each profile links to a house on the Sorting Hat, and the hub hands threads hat keys for it. It never runs turns itself. Each client window uses one hub at a time, with multiple machines connected to that hub. A machine can save several independent hubs, such as Home server and Local dev; hubs have separate state and durable identities. It relays threads between machines without storing them.
_Avoid_: Home machine, accio hub, accio proxy, CLI proxy, gateway, master, connector

**Pairing**:
Trusting a machine or client once so it can reach the hub and receive the shared settings. Unpairing removes that trust and its hat keys.
_Avoid_: Linking, registering

**Client**:
The app you use to read threads, send prompts and change settings. It holds no threads of its own and does not execute turns; a worker does that. A client can run on a machine with or without a worker. Planned iOS and standalone web apps are clients only. Currently the desktop app combines a client with a local worker, and the web client is served by a worker.
_Avoid_: Thin client (in UI text), frontend, desktop (for the role)

**Developer CLI**:
The agent-facing terminal client (`pnpm cli`) for quick testing, debugging and verification during development without opening the UI. It calls the running worker's authenticated app protocol and returns JSON; supported remote operations use the worker's relay. Use it for behavior and state checks, and the UI verification journeys for rendering and interaction checks. See [terminal client usage](README.md#terminal-client).
_Avoid_: Harness, accio tool (for this development client)

**Worker**:
The process on a machine that runs harnesses, executes turns and provides access to that machine's files and tools. It can run alongside a client or on its own. It remains a worker while idle; it does not need a running turn. The current implementation is `apps/worker`, started by the desktop app or headlessly with `pnpm worker`.
_Avoid_: Server (for the role), machine (for the process), agent, sub-agent

**Relay**:
The hub passing messages between workers on different machines, so you can read and drive a thread from any client. The thread stays on its worker's machine; nothing is copied. Each client lists every machine's threads together, with the owning machine's name on the others. While that machine is offline its threads stay listed from the last list it sent, greyed and read-only, except that you can snooze them until the machine is back. A new thread can start on any machine on the relay, in any project the hub keeps: a machine without a checkout of the project's repository, this one included, clones it first, into the profile's folder there or else its home folder. No project starts on any machine. Saved images and files can be viewed through the relay. Sending image attachments, editing thread skills and Open app for an owned preview require the thread's machine. See the [relay plan](docs/plans/thread-relay.md).
_Avoid_: Sync (for threads), tunnel

**Update**:
Bringing a machine's Accio to the latest `main`: it fast-forwards the checkout the desktop app runs from, installs, builds and restarts, and its interrupted turns continue by themselves. A failed install or build resets to the previous commit and rebuilds it while the app keeps running. Only a clean checkout of `main` can update. Started from Settings → Machines or by a thread through the app_update accio tool, on this machine or, through the relay, on another one.
_Avoid_: Upgrade, deploy, self-update (in UI text)

**Accio version**:
What a machine or hub runs, as `0.1.<n>`, where n counts the commits it was built from; each commit on `main` raises it by one. Settings → Machines shows it for the hub and every machine.
_Avoid_: Commit hash (in UI text), build number

**App screenshot**:
A PNG of a machine's Accio desktop window, which a thread takes through the app_screenshot accio tool, on its own machine or another one through the relay. A script can run in the window first to open the view to capture. It shows the whole window with its title bar buttons; when the OS won't give that, such as on macOS without Screen Recording permission, it shows the page only and says why.
_Avoid_: Capture (as a noun), snapshot

**Shared settings**:
Everything the hub stores and hands to every paired machine, so that you change it once from any client: the profiles with their houses on the Sorting Hat, the projects with a remote and which profile each belongs to, the spaces, the harnesses, skill sources, MCP servers, and each machine's profile folders. A few of them apply to one machine only, such as its profile folders, but they are still stored on the hub. A client keeps only its own look and feel, such as the theme.
_Avoid_: Config, fleet, machine settings (for settings stored on the hub)

## Profiles

**Profile**:
A named side of your life that threads run under, such as "personal" or "work". You choose which profiles exist, and they are defined on the hub. Each profile links to one house on the Sorting Hat, usually of the same name, and its threads reach only that house's accounts. Choosing a profile's accounts in Accio changes that house, for every app that uses it.
_Avoid_: Account, environment, identity

**Profile folder**:
A folder on one machine whose new projects default to a profile. Each machine has its own, since paths differ between machines, but the hub stores them with the other shared settings.
_Avoid_: Root

**GitHub account**:
The gh login a profile's threads use for GitHub: Accio's own Ship checks and the agent's gh commands. It is chosen once per profile, in the profile's settings, and holds on every machine. The token comes from each machine's own gh, so Settings → Machines shows whether gh there is signed in to it; where it isn't, gh's active account stands in. Left on Automatic, it is the account git sends for the repository's origin, so reads act as the same account that pushes.
_Avoid_: GitHub profile, GitHub identity

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
Tools accio gives every harness, such as offer_choice. Each machine serves them to its own harnesses over MCP, under the name `accio`; each turn may use them only while it runs. Some are offered only to the turns that need them, such as shipped_note to a delivery turn.
_Avoid_: Accio MCP, custom tools, plugins

**Image generation**:
Making an image, or editing one, with the profile's ChatGPT account through the Sorting Hat's image routes. Threads on every harness can do it with the generate_image accio tool, which is offered only while the profile's house has a signed-in ChatGPT account. The image is saved on the thread's machine for the thread to embed. It uses the ChatGPT account's limits and counts in its usage.
_Avoid_: Image attachment (an image you send), DALL·E

**Built-in tools**:
A harness's own tools, such as Claude Code's WebSearch or Codex's goals, grouped into switches under Settings → Harnesses. The switches are shared settings for the whole hub. By default only a shell and file reading and editing are on; other capabilities come as accio tools that work the same on every harness. Changes apply from each thread's next turn.
_Avoid_: Default tools, native tools, harness tools

**CLI**:
A command-line program that Accio installs at a pinned version on every machine and tells threads about, such as agent-desktop. It is turned on at the same levels as skills: Everywhere, Profile, Space or Project, and where two CLIs share a command the narrower level wins. A program you installed on a machine yourself is not a CLI until you add it to Accio, in Settings → CLIs or by asking a thread, which uses the add_cli accio tool. A CLI that is broken on a machine never holds a turn up; the turn is told it is unavailable there.
_Avoid_: Tool (on its own), managed tool, binary

**System prompt**:
What accio adds to a harness's own instructions for every turn: titled sections that describe accio's chat, such as how to show images inline. Each harness receives it in its own way. Claude Code gets it after its built-in system prompt and Codex as developer instructions. It is read-only and shown under Settings → System prompt.
_Avoid_: Instructions, preamble, custom prompt

## Sorting Hat

**Sorting Hat**:
The service that holds provider accounts and sends each model request to one of them. It knows nothing of Accio: any app with a hat key can use it, and Accio is one such app. Its dashboard shows usage, limits, accounts, houses and hat keys.
_Avoid_: Proxy, gateway, CLI proxy, account service, hub (for this service)

**House**:
A named group of accounts on the Sorting Hat, ordered per provider, such as "personal" or "hrc". Several apps can use one house: Accio's personal profile and pi can both use "personal". An account may belong to several houses.
_Avoid_: Pool, group, profile (on the Sorting Hat)

**Hat key**:
What an app presents to the Sorting Hat to send model requests through one house's accounts, and nothing else. Accio's threads get one per profile and machine; other apps get their own, so each can be revoked alone and its usage shown apart.
_Avoid_: Model key, access key, API key, token, secret

**Account**:
One login at a provider, such as a personal Anthropic account, held by the Sorting Hat. It has a custom name, is set up independently, and can belong to several houses. An account at Anthropic is called a Claude account; an account at OpenAI is called a ChatGPT account.

**Account in use**:
The account a house's next request uses at a provider, which the Sorting Hat chooses among its signed-in accounts there. It skips accounts whose sign-in the provider has ended, and accounts with 5% or less left in any window until that window resets, and otherwise prefers the account whose weekly allowance resets soonest; the house's order breaks ties. It can change during a thread.
_Avoid_: Login, sign-in (as a noun for the account), subscription, provider instance

**Sign-in**:
Signing an account in on the provider's page, from Accio or the Sorting Hat's dashboard. Claude and ChatGPT finish automatically after browser approval. Provider credentials stay on the Sorting Hat. Signing out clears its credentials while preserving its name and houses. A provider can end a sign-in on its own, such as by refusing its refresh token; the account then needs signing in again.
_Avoid_: Login (as a verb or action), auth, connect

**Usage**:
The tokens a house's requests used, per hat key, account and model over time, as the Sorting Hat counted them. Not the same as limits, which the provider reports.
_Avoid_: Consumption, spend, quota

**Limits**:
The allowance windows and reset times a provider reports for an account, read by the Sorting Hat with the account's own credentials. Houses that share an account share one allowance. Shown in Accio from the sidebar, a draft's composer, a thread's Context window popover and account settings, and on the Sorting Hat's dashboard.
_Avoid_: Quota, usage, rate limit (in UI text)

## Work

**Project**:
A repository, recognised across machines by its git remote URL. It belongs to exactly one profile, which can change only while the project has no threads on any machine. The hub keeps each project with a remote and its profile, whether or not any machine has a checkout of it, so New thread lists it on every machine. A machine adding a checkout of a repository the hub already has joins it under the hub's profile: the first machine to add a repository decides it. The hub forgets a project once its last checkout anywhere is removed (an offline machine counts by its last list). A folder without a remote is a project on its own machine only.
_Avoid_: Workspace, repo (in UI text)

**Space**:
A named group of projects that share context, such as "hrc" or "Copilot Studio agents". A project is in at most one space, or in none. A space is not tied to a profile, so its projects may belong to different profiles. A space can have a home, which holds what applies to the whole space. Its projects can read and change each other, and each project ships its own changes.
_Avoid_: Workspace, home, group

**Home**:
The project in a space that holds what applies to the whole space, such as its glossary, decisions and notes about each project. It is an ordinary project in every other way: threads start in it and ship changes to it. A space has at most one home. Settings labels the picker "Home project"; its "New home…" creates one from Accio's built-in home template and starts a first thread in it that fills it in from the space's projects.
_Avoid_: Home repo (in UI text), space repo

**Checkout**:
One machine's copy of a project's repository. A folder without a git remote is a project with a single checkout. Starting a thread on a machine without one, from New thread or through the relay, clones the repository there under the hub's profile for it and adds it, reusing a clone already in place. It clones from the remote URL of a machine online that has a checkout, else from the https address of the repository. A project of a space is cloned the same way on a machine where a thread in the space runs; one without a remote, or whose profile neither the hub nor a machine online knows, is not available on that machine.
_Avoid_: Clone, project folder

**Owned worktree**:
A separate Git working copy and branch allocated to one thread. New threads in committed Git projects work here; existing threads, ordinary folders and empty repositories keep their original directories. Ownership lasts until Archive releases it. Process management currently covers Accio's preview runner; this is not complete process isolation.
_Avoid_: Sandbox, project (for the thread's working copy)

**Thread**:
A durable conversation with a harness, optionally attached to a project's checkout and owned worktree. It exists from its first message on. It keeps its starting hub and profile; its model can change, including to another harness through a handoff. Accounts follow its profile's house. A No project thread runs under a profile without a project checkout.
_Avoid_: Chat, session, agent, conversation

**Draft**:
What a composer holds before it sends: text, Pasted text and image attachments. It stays when you move to another thread; text and Pasted text also survive a restart. A new thread whose draft has something in it is listed at the top of the inbox as Draft until it is sent or emptied; it is not yet a thread. In a thread, Up in an empty composer brings back the text of your last message there as a draft.
_Avoid_: Unsent thread, pending thread

**Turn**:
Work by the harness until it finishes or is interrupted, started by a user message, Resume, a delivery request, a Goal's next step or a Wait being met. Each turn uses the account in use of the profile's house for that harness's provider. Steering can add messages during the same turn.
_Avoid_: Run, request

**Context window**:
How many tokens the model can take in one request, and how full a thread's latest request left it. The harness reports both: Claude Code when a turn ends, Codex as it goes. Accio never assumes a size from the model's name. The latest request counts with its reply, which the next request carries. Claude Code also reports where it compacts the conversation, marked on the window. A pill in the thread's composer shows it; its popover also holds the account's limits, the prompt cache and the last request's prompt size.
_Avoid_: Token count, memory, context size (in UI text)

**Queued message**:
A message saved to start a later turn after the current turn finishes. It can be edited, removed or sent as steering while the harness accepts input.

**Image attachment**:
An image pasted into the composer and sent with a message. It is kept with the thread, shown in the message and given to the harness both as an image and as a saved file it can open. Only models that read its type can receive it.
_Avoid_: Upload, file (in UI text)

**Pasted text**:
A long text paste (4,000 characters or 60 lines) that the composer keeps out of the message box as a chip. It is sent inside the message, before the typed text, as a fenced block the harness reads as plain text, and the thread shows it folded to its size and first line. Ctrl+Shift+V pastes it into the message instead, and the chip puts it back there.
_Avoid_: Attachment, file (in UI text)

**Reaction**:
A 👍 (agree), ❓ (unclear: explain it again) or 👎 (disagree) on a passage selected in an assistant message, picked from the small bar that appears over the selection. It goes into that thread's composer as a chip whose emoji switches the reaction; several can travel in one message, with or without typed text. It is sent after any Pasted text and before the typed text, as a fenced block whose info string says what it means, and the thread shows it as the emoji beside the quoted passage.
_Avoid_: Citation, quote (for the whole thing), feedback

**Steering**:
Sending a message to the harness during its current turn, without interrupting it or starting a separate turn.

**Handoff**:
Moving a thread to another harness by choosing one of its models. The next turn on that harness starts a new session, or resumes the one it left, with the conversation it has not seen, taken from accio's transcript and trimmed to fit. The harness can read the whole thread with the read_thread accio tool (ADR 0017), which also reads a thread you mention.
_Avoid_: Switch, transfer, migration

**Running**:
The state of a thread while a turn is in progress.

**Interrupted**:
The state of a turn that stopped before finishing, because you stopped it or its machine restarted. It continues only when you resume it.
_Avoid_: Cancelled, failed (for this case)

**Failed**:
The state of a thread whose last turn ended in an error. You can send it another message.
_Avoid_: Errored, crashed

**Confirmation**:
A card in a thread on which an accio tool waits until you allow or decline its action, such as add_cli turning a CLI on Everywhere. It ends unanswered when its turn ends or after ten minutes, and then counts as declined.
_Avoid_: Approval, permission prompt, dialog

**Choice**:
Two or more screenshots a harness shows side by side, through the offer_choice accio tool, when you ask it to prototype, try or mock up UI for a feature. You pick one in your next message and add feedback if you like; the harness reads the pick on the message's first line.
_Avoid_: Board, gallery, poll, variants (for the whole set)

**Goal**:
What a thread keeps working toward across turns, set with `/goal <objective>`. accio starts each next turn itself until the harness reports it achieved or blocked through the finish_goal accio tool, or a turn stops, fails or uses no tools. There is no turn limit, as in Claude Code and Codex; a bar above the composer shows it with pause, resume and clear. It works the same on every harness; no harness's own goal feature is used.
_Avoid_: Task, objective (for the whole thing), loop

**Sub-agent**:
A helper turn that a thread's harness starts through the `agent` accio tool for one self-contained task, such as independent research or a black-box check. It runs on the thread's model, or on a model you mention, with the same profile and working folder and a fresh context, and gives back only its final reply. It is not a thread and keeps no transcript; while it works, its latest step shows on the parent's Agent row. Sub-agents get no accio tools, so they cannot start sub-agents of their own.
_Avoid_: Subthread, child thread, worker, helper thread

**Started thread**:
A new thread that another thread starts through the start_thread accio tool, when you ask for one, for example on another machine. Unlike a sub-agent it is a full thread: it has its own transcript, shows in the list, and you follow it and talk to it yourself. It starts in the same project, on the thread's machine or in another machine's checkout of the same repository, cloned there if needed, and on the starting thread's model unless you mention another. A thread in a space can start one in another project of the space instead, including the home: it works in that project's checkout on the chosen machine, under that project's profile. The starting thread does not wait for it, unless it sets a Wait on it.
_Avoid_: Child thread, spawned thread, sub-thread

**Wait**:
What a thread waits for between turns, set by its harness through the wait_for accio tool: threads it started reaching a state (stopped, a pull request open, delivered), a pull request merging or finishing its checks, a time, or a command accio runs exiting. The harness ends its turn; accio watches the conditions itself and starts the next turn, with what happened, when any of them is met, or all if the harness asked. A started thread that fails or is interrupted meets every Wait on it. A Goal pauses while its thread waits. You can talk to the thread meanwhile and the Wait stays; a bar above the composer shows it and can cancel it, and settling the thread cancels it too. A command still running when accio stops does not survive it: the Wait wakes and says so. It works the same on every harness; no harness's own background or scheduling feature is used.
_Avoid_: Subscription, watch, trigger, wakeup, sleep

**Model mention**:
Naming a model in a message with `@` and its handle, such as `@sonnet` or `@sol`, so sub-agents for that work run on it, on either harness. The handle is the model's family; when two offered models share one, both add their version, such as `@opus-5.5`. Typing only `@` in the composer offers Models, Machines and Threads, each opening its list; typing after it lists the matches of every kind. Each mention shows as a pill in the composer and as a chip in the sent message, which keeps the text. The thread's own model does not change.
_Avoid_: Tag, model reference

**Issue tracker**:
Where a project's open issues live, as its agent skills record it in `docs/agents/issue-tracker.md` or the Agent skills block of CLAUDE.md or AGENTS.md: GitHub Issues, or markdown files under `.scratch/<feature>/issues/`. Without that record, local issue files, else a GitHub origin, stand in. Accio reads GitHub through the profile's GitHub account; it cannot list other trackers yet.
_Avoid_: Backlog, ticket system

**Issue**:
One open issue a new thread can pick up. In a project's draft, the Pick an issue chip beside the machine lists them: GitHub issues by triage label (Ready for agent, Needs triage, Open for unlabelled, Ready for human, then Blocked); local issues by feature. Issues an open thread in the project already works on come last, under In progress: choosing one opens that thread, and its New thread button attaches it anyway. A thread knows its issue from the pick, or else from the first `#123` in its first message's first line, as when another thread starts it. The chip shows only when the tracker has open issues. The picked issue sits above the message, which may then be empty; sending names it in the first message (`Work on #208: …`), starts the thread's title from it, and claims it once the thread has started: assigned to you on GitHub, or `Status: claimed` in the thread's worktree copy of a local file. A claim that fails is noted in the thread.
_Avoid_: Ticket, task

**Issue offer**:
The issues a harness has just published to the project's tracker, which it offers through the offer_issues accio tool. The call fails for a reference the tracker doesn't list as open. The thread shows each issue as a row, with its status read from the tracker: Ready, Waits on, Claimed or Closed. A Ready row has **Implement**, which starts a thread on this machine, on the thread's model, in the same way as the Pick an issue chip, so the issue is claimed and titles the thread. The first message names the issue, asks for the implement skill if it is enabled, and mentions the planning thread so the new thread can read it. The row then opens that thread. The planning thread keeps running on its own.
_Avoid_: Ticket list, handoff (for this)

**Machine mention**:
Naming a machine in a message with `@` and its handle, such as `@laptop`, so the turn's machine tools, such as App screenshot and Update, act on that machine. The handle is the machine's name in lowercase words joined by dashes; when two machines share one, both add the start of their id. A model's handle wins over a machine's. The thread keeps running where it is.
_Avoid_: Machine tag, target

**Thread mention**:
Naming another thread of the same profile in a message with `@` and its handle, such as `@fix-login-redirect-3f2a9c`, so the agent can read it. The handle is the first words of the thread's title and the start of its id; only the id part counts, so it still works after a rename. The harness gets a line about each mentioned thread after the message (its title, where it sits in the sidebar, its machine, branch and PR), not its conversation; it reads that with the read_thread accio tool, newest items first, on any machine through the relay. Before you type, the @ menu's Threads lists recent ones: open first, then Working, then recently settled; typing searches all of them by title.
_Avoid_: Thread link, thread reference

**Snooze**:
Hiding a thread until a chosen time, when it comes back. Another machine's thread can't be read or settled while that machine is offline, so it is snoozed until the machine is back instead, or for a week if it stays away. Its machine can't record that snooze, so the hub keeps it, and every machine shows it; the hub drops it when the machine reconnects, so the thread wakes everywhere at once. While its system sleeps a machine stays away from the hub, so a dark wake, which runs it for a moment, does not count as back.
_Avoid_: Mute, defer

**Settle**:
Marking a thread as done in the sidebar, by hand or automatically once its delivery is verified. It stays readable and can be reopened. Settling by hand releases an owned worktree that holds no work: no commits since it started, nothing uncommitted or untracked, no delivery and no running preview. A follow-up then gets a fresh worktree from the latest default branch and continues the same conversation. A worktree holding work stays allocated.
_Avoid_: Archive, close, resolve

**Ship**:
Requesting delivery from the owning thread: finish the work, integrate the target branch, verify and publish under the project's direct or pull-request policy. A request made during work waits for that turn to finish. It authorizes publication under its recorded policy.

**Delivery step**:
The part of a delivery the agent, or a scripted ship, says it is on (commit, integrate, verify or publish), with a short note. The agent reports it through the delivery_step accio tool. The Delivery panel shows it with the turn's elapsed time. It is for following along only; accio's own delivery checks never depend on it.
_Avoid_: Phase, stage

**Scripted ship**:
A direct Ship in a project with a test command, run by accio without a model turn: commit, rebase onto the target, run the test command (once more if it fails), push. A conflict, a second test failure or a target that keeps moving hands over to the delivery turn, with what happened. The lightweight naming model writes the commit message and shipped note.
_Avoid_: Fast ship, auto ship

**Shipped note**:
What a delivery changed and what to try, written by the delivery turn through the shipped_note accio tool, or by the naming model for a scripted ship, for the person who will use the change. Once the delivery is verified, the thread shows it as a turn of its own and the Changelog lists it. The thread itself settles automatically like any delivered thread; the note lives on in the Changelog and the project dashboard's Recently shipped.
_Avoid_: Release note, summary, receipt

**Changelog**:
Every change delivered on a machine, newest first, each with its shipped note, target, PR and revision. Each project's Changelog is a fold on its project dashboard, grouped by day; it can be searched and opens each change's thread while that thread exists. Entries outlive later deliveries, Archive and deletion of their thread; changes delivered before notes existed are listed by thread title.
_Avoid_: History, activity, release log

**Delivery policy**:
A project's choice of how Ship publishes: directly onto the target branch, or through a pull request. It applies to new requests; an existing request keeps the policy it was recorded with. A branch with an open PR, or a target whose rules require PRs, checks or a merge queue, always ships through the PR.
_Avoid_: Merge mode, strategy

**Prepare for review**:
Requesting preparation and verification of a pull request without authorizing its merge. The owned worktree stays available for review fixes.

**Archive**:
Releasing a delivered thread's owned worktree and branch after checking its published revision, preserving unpublished work and stopping its owned preview. Conversation history remains, the thread is settled, and a follow-up allocates a fresh worktree. See the [delivery notes](docs/plans/thread-delivery.md) for eligibility and recovery.
_Avoid_: Settle, delete (for releasing execution resources)

**Owned preview**:
The app a thread's harness starts from its owned worktree through the project's preview command, on its own port, opened by the **Open app** button. Accio stops it on Archive or shutdown. Processes started any other way are not previews.
_Avoid_: Dev server, sandbox

**Project dashboard**:
A project's page, opened through Dashboard in the menu on the project name in a thread's header: the project's threads grouped as Needs you, Working and Snoozed, one line each, then Recently shipped (the default branch's newest commits, one line each, a pull request's merge commit shown by the PR's title, each joined to its Changelog entry and expanding to its shipped note, things to try, thread and PR), then its Issues, Changelog and settled threads, all folded. The Issues fold reads the project's issue tracker each time it opens and lists the open issues in dependency order (no issue above one it waits on) with a git-log style graph in the gutter: a dot per issue, a line from each issue down to the issues it unblocks. Each row says Ready, Blocked (with what it waits on) or Claimed; a filter narrows it to one parent issue or feature folder. It says why it is empty: no checkout here, no tracker, the tracker unavailable, or nothing open. Clicking an issue highlights its row and opens it in a reader beside the list (a sheet in a narrow window): its state and triage label, its Blocked by and Blocks as links that move the reader, its body (read when it opens, through the profile's GitHub account or from the local file) and a link to GitHub when it has one. A ready issue's reader has Start a thread, which starts and claims a thread on it as picking it in a draft does, then opens it; a blocked or claimed issue can't be started there. When a thread in the project already works on the issue (an open one, or a settled one for a claimed issue), the reader has Open thread instead.
_Avoid_: Project settings (for this page), overview

**Space view**:
A space's page, opened through Space in the menu on the project name in a thread's header (only for a project in a space) or through Open on the space's row in Settings / Spaces: the home pinned on top with New thread in home, then each other project with its profile, its checkout on this machine, its threads that need you or are working, its project dashboard and New thread.
_Avoid_: Space dashboard, space settings (for this page)

**Shelf**:
A group of threads in the sidebar apart from the open list: Working, Snoozed and Settled. Working holds threads in progress without you: a running turn, a delivery GitHub is carrying, or a Wait. A thread comes back to the top of the open list when it finishes or needs you, such as for a secret, a review or a manual merge.
_Avoid_: Folder, inbox, tab

## Secrets and hub connections

**Secret**:
A named token a thread can request through the `request_secret` accio tool. Values stay write-only on the hub, encrypted, and reach the harness only as a temporary file for one turn.
_Avoid_: Credential (for provider tokens), key, hat key, password

**Save & use**:
Answering a secret request by keeping the value on the hub for the current profile, project and purpose, so later requests for that purpose are answered automatically.

**Use once**:
Answering a secret request for the current turn only; nothing is stored.

**Hub connection**:
A machine's saved record of one hub: its name, URL and server-only credential, with its own local workspace under `hubs/<hub-id>`. A window selects one connection at a time.
_Avoid_: Server (in UI text), endpoint

## Skills

**Skill source**:
A git repository of skills that the hub pulls and hands out, such as spellbook. Individual skills can be turned on at a skill level or kept optional in the library. Copying one into a project creates independent files owned by that project's Git history.
_Avoid_: Skill pack, plugin

**Skill level**:
Where a thread's skills come from, widest first: Everywhere, Profile, Space and Project. Everywhere means every machine, profile and project on the hub, never one machine. A project's skills are its repository's skill files plus library skills turned on for it; a space's are its home's skill files plus library skills turned on for it. A thread in the home gets the home's skill files as Project skills. When two levels have a skill of the same name, the narrowest wins and the other is overridden. Skills installed on a machine, such as in `~/.agents/skills`, are no level and never reach a thread. See ADR 0020.
_Avoid_: Global (for one machine), scope, tier

**Harness skill**:
A skill that ships with a harness, such as Codex's skill-installer. It reaches only that harness's threads and can't be turned on or off at a skill level.
_Avoid_: Built-in skill, default skill, system skill
