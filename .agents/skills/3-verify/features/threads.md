# Coding threads, models and thread organization

Users choose a project or profile, select a model, send prompts, observe streamed replies/tools, interrupt or resume work, and organize conversations through search, filters and shelves.

## Sub-features

- `threads-picker`: project, multiple-checkout, and No project/profile entries with mouse/keyboard search.
- `threads-models`: provider tabs, model search, favourites, per-thread harness restrictions.
- `threads-turn`: first send, streaming transcript, follow-up, tool effects and persistence.
- `threads-stop`: stop from composer/row/menu; resume interruptions; retry failed turns.
- `threads-find`: title search, clear, profile/project filters and clear filter chip.
- `threads-organize`: rename, snooze/wake, settle/reopen, shelf expansion/paging, confirmed deletion.
- `threads-delivery`: owned Git worktrees, Ship/review intent, cancellation, remote verification, preview ownership and safe Archive.

## How to get to it (user POV)

- Sidebar `New thread` button; the idle pane also has `New thread` after setup is complete.
- Pick a project, then a checkout if multiple exist; alternatively pick `No project`, then a profile if multiple are available.
- Select an existing thread row to reopen its transcript. Its right-click menu exposes thread actions; hover buttons also expose Stop/Snooze/Settle/Wake/Reopen where applicable.
- Sidebar `Search threads`, `Filter threads`, and nonempty `Working`/`Snoozed`/`Settled` shelves organize the list.

## Driving it with Playwright

Preconditions: healthy instance. Picker and signed-out gating can be tested after UI profile creation. A successful turn requires a real signed-in selected provider account and a reported model; a project thread also needs the disposable folder added. Search/shelves need actual threads; paging needs more than five settled threads. The baseline supplies none of these authenticated thread fixtures. Report unavailable journeys as failed prerequisites/unverified coverage; never insert fake threads into storage to call this an end-to-end proof.

- **Picker, mouse and keyboard.** Click `page.getByRole('button', { name: 'New thread', exact: true })` (scope to sidebar or main if both exist). Fill combobox `Search projects`, then click `page.getByRole('option', { name: /^verify-project/ })`. If several checkouts exist, require and choose the intended path option. Also exercise ArrowDown/Enter through that combobox. For `No project`, click its exact option; with two profiles require combobox `Search profiles`, search and choose a profile option. Require heading `What should we build?` or `What should we build in verify-project?` and the chosen profile's account gate/model controls.
- **Signed-out gate.** In the baseline draft fill `page.getByRole('textbox')` in `.composer` with a prompt. Require `Send` disabled and the status notice about the profile not being signed in. Click `Choose account` to open that profile. This proves only gating.
- **Models.** With a signed-in account click button matching `/^Select model:/`. Use textbox `Search models` and navigation named `Model groups`. Select the actual available provider/harness tab, search for a returned model name, click its `[data-model-choice]` button, and require the trigger to reflect that model. Star via the actual `Add <model name> to favourites` button; reopen the Favourites tab and require the model. Reload and check the favourite persists. On an existing thread require choices restricted to its original harness.
- **First send and reply.** Ask for `Reply with ACCIO_VERIFY_OK and do not run tools.` in a signed-in scratch-project draft. Click exact `Send` (also exercise Enter and Shift+Enter on separate follow-ups). Require the user prompt in `.messages .msg.user`, a real assistant reply containing `ACCIO_VERIFY_OK` in `.messages .msg.assistant`, and a completed nonfailed thread in the sidebar. Reopen and reload; require preserved user and assistant items. The model's exact prose beyond the requested marker may vary.
- **Tool side effect.** In the disposable project only, request creation of `accio-verify.txt` containing `ACCIO_VERIFY_FILE`. Require the rendered tool activity and actual file/content under `fixture`. Capture prompt, tool/result transcript, file contents and `git status` if using a git fixture. A textual claim of creating the file is insufficient.
- **Stop/resume/retry.** During a real running turn click composer `Stop`, row `Stop`, and right-click menuitem `Stop` in separate runs. Require interrupted status and button `Resume`; click it and require continuation without duplicating the user prompt. A failed real turn should show `Retry`; fix the actual prerequisite, retry and require a new outcome. A turn that finished before Stop is not an interruption proof.
- **Find and filter.** With two real differently titled threads, fill searchbox `Search threads`, require only matching titles, click `Clear search` and require restoration; repeat Escape while focused in the searchbox. Click `Filter threads`, choose menuitemradio for the actual profile/project, require correct results; click the `Clear filter: <name>` button to restore all. Search empty results must show the app's empty state.
- **Menus and shelves.** Right-click the intended thread's `.row-main` button using `{ button: 'right' }`; click menuitem matching `/^Rename/`, fill textbox `Thread title`, press Enter, reopen/reload to require persistence. Test hover `Snooze` and menuitem `Snooze until morning` separately, expand the `Snoozed` button, then test hover `Wake` and menu `Wake now`. Similarly test hover/menu `Settle`, expand `Settled`, then hover/menu `Reopen`. With more than five settled threads, exercise `Show … more` and require the additional rows.
- **Delete confirmation.** Right-click a stopped/nonrunning row, click menuitem matching `/^Delete thread/`; require `Delete for good` before deletion. Dismiss the menu once to prove cancellation. Repeat and confirm; require row, stored thread and transcript removal. A running thread must disable deletion until stopped.
- **Proof.** Capture actions, streaming and final snapshots, `threads.json` metadata and selected non-secret `transcripts/<id>.json` fields before teardown. The default smoke does not claim authenticated thread coverage.
- **Delivery.** Use a disposable committed Git project with a disposable origin; never ship the user's repository as a verification step. New Git threads must have different worktree paths. Click `Shipping options`, choose `Prepare for review`, and require a PR without a merge. For Ship, click while a gated test harness is working; require `Ships when done`, persisted queued intent and exactly one subsequent delivery turn. `Cancel queued delivery` preserves the work turn. Require remote proof before `On <branch>` and `Archive` appear. Add an untracked file before Archive and require a refusal with the file and workspace preserved. After successful Archive, inspect only the owned worktree/branch removal and preserved conversation, then send a follow-up to prove fresh workspace allocation. The committed delivery browser fixture injects the coding harness; identify that boundary and keep real-provider/GitHub review coverage separate. An ordinary ready PR retains its workspace. Configure a project preview command that responds on PORT; require Open app to open a responding service, and Archive to stop that owned process tree. See [delivery notes](../../../../docs/plans/thread-delivery.md) for current limits.

## Gotchas

- Sending creates the thread; opening a draft alone does not persist a conversation.
- Coding harnesses have full permissions. Keep all tool tasks inside the runner's disposable project; never test a prompt against the user's checkout.
- Favourites may initially be empty while provider tabs contain models. Empty favourites is not an empty provider catalog.
- Search matches thread titles, not transcript contents. Rename a real thread before testing a specific search term.
- Shelves exist only when nonempty and default to collapsed. Profile/project filters and search affect their contents too.
- The baseline has no provider authentication, real turn, multi-checkout fixture or six-thread paging fixture. Keep each missing branch explicit in coverage.
