# Verification and shipping

Choose checks from the changed behavior and its dependencies before running them.
Record the commands, tested revision, results and any failures in the thread.
Shipping authorization includes routine diagnosis, fixes, integration and push retries.
Continue until publication and required checks complete; ask only for missing access
or a product decision that cannot be resolved from the task and repository.

## UI changes

For changes confined to React components and CSS, run:

```sh
pnpm verify:ui delivery.spec.ts delivery-merge.spec.ts
```

Replace the example files with the browser tests covering the changed interactions.
The command builds and typechecks the workspace, runs web unit tests, then runs those browser files
on the selected fixture project (default `chat`). Use `--project=limits` or
`--project=secrets` or `--project=relay` for those fixtures, and `--project=sortinghat`
for the Sorting Hat's dashboard (a standalone Sorting Hat with faked providers). It saves full stdout/stderr, commands, exit
codes, revision, working-tree status and timings under the printed
`out/verify-ui/<run>/report.json` path, and stops at the first failed stage. Browser
artifacts also belong to that run, so retries keep earlier traces. Empty browser
selections fail rather than pass.

For a focused browser retry after inspecting a failure:

```sh
pnpm verify:ui delivery.spec.ts --skip-build --grep "CI wait"
```

Use `--skip-build` only after a successful build of the current sources. Rebuild
after source edits. The web unit tests still run; browser retries are explicit.
Read the relevant [UI feature map](../.agents/skills/3-verify/features/README.md)
and use its real-app journey when fixture tests cannot establish the changed behavior.

For worker, protocol, persistence, shared infrastructure, or build/config changes,
add the affected unit/integration suites and consumers. Run the full suite when
impact crosses boundaries, coverage is uncertain, or a repository/CI requirement
mandates it. Once the selected checks pass, publish; add checks only for new
changes, failures or unresolved risks.

A project's configured test command remains the contract for scripted shipping;
required remote checks remain enforced. This focused command is for choosing local
UI checks, not bypassing either requirement.

## Failures

1. Read the failing assertion, complete log and browser trace/context first. Check
   the expected behavior against the current implementation and specification.
2. Retry the failing test once in isolation. Preserve both outcomes. If it passes,
   report the intermittent failure and continue with the remaining planned checks;
   a passing retry does not establish its cause. Track its test name and evidence
   in the delivery report rather than rerunning the whole suite for reassurance.
3. If it still fails, diagnose and repair regressions autonomously. To establish
   that a failure predates the change, use a separate disposable worktree at the
   exact fetched target commit, with the same command and prerequisites. Preserve
   the shipping worktree. One inconsistent baseline run proves neither causality
   nor independence. Existing target failures may be reported and excluded only
   with matching evidence; required CI checks still must pass.
4. A retry limit ends blind repetition, not the task. Continue with a smaller
   reproduction, instrumentation or a controlled comparison. Repair outdated tests
   when current intended behavior is clear; preserve their behavioral assertions.
   Resolve environment/setup failures and resume the affected checks.

## Integration and completion

Fetch and integrate early. Preserve successful evidence while the tested change
and its relevant dependencies remain unchanged. Inspect the incoming diff after a
rebase: clean integration of unrelated changes keeps prior evidence. For conflicts
or overlapping dependency changes, inspect the resulting diff and rerun affected
checks. A conflict in one test does not invalidate every unrelated suite.

If the target advances before push, integrate and retry a normal push. Keep going
without a new approval request. Avoid another full verification cycle after an
unrelated clean rebase. Accio observes required remote checks and resumes the agent
for failures; that observation complements local behavior evidence.

Done means the authorized revision is published, required remote checks have been
observed, and the thread reports the revision, checks and any evidenced pre-existing
or intermittent failures. Never claim a failed or unexecuted check passed.
