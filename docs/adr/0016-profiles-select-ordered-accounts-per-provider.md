> Partly superseded: accounts, their sign-in and the account in use moved from the hub to the Sorting Hat (ADR 0018). What follows still describes how it works there.

# Profiles select several accounts per provider, and the hub picks one per request

A profile selects any number of accounts at each provider, in order, instead of at most one (ADR 0010). The hub stores them as one ordered list of account ids per profile. For each model request it picks the account in use among the signed-in ones (now `apps/sorting-hat/src/accountChoice.ts`, ADR 0018):

1. Accounts with 5% or less left in any general window are set aside until that window resets.
2. Of the rest, the account whose weekly or monthly allowance resets soonest is used, because whatever it has left is lost at that reset. Accounts whose limits are unknown come after those with a known reset.
3. When every account is low, the one that becomes available first is used.

The profile's order breaks ties and decides while no limits are known. The choice comes from the limits the hub already reads per account. Each request through the proxy asks for a non-forced read of the profile's accounts at that provider, which the cache keeps to about every five minutes per account (Anthropic rate-limits usage reads made once a minute) and right after a shown reset. When a provider answers 429, the hub reads that account's limits again at once (waiting up to 5 seconds), and if the choice moves to another account it resends the same request with that one, once. Clients receive the choice as `inUseId` on each provider of a profile view, and show it in the profile settings, the Limits view and the composer's limits chip.

The choice applies to each request, including in a running thread. Claude Code sends the whole conversation with every request, so a Claude thread continues under the new account, with a cold prompt cache. Codex does too, but whether reasoning that one ChatGPT account encrypted is accepted under another is unverified.

`profiles.save` takes `accountIds` per provider. The earlier `accountId` and `openaiAccountId` remain as the single-account form, and clients send both, so a hub from before this change still applies the first account. Stored single-account profiles are converted on load.

## Considered Options

- **Use the first signed-in account and let the user switch by hand**: predictable, but the user has to watch limits, and allowance left on an account with an earlier reset is wasted.
- **Switch only at 0% left**: the request that hits the limit fails before the hub learns about it, and limits are read at most about every five minutes, so a margin of 5% switches before most refusals. The 429 recheck covers the rest.
- **A separate pinned account next to the list**: one more piece of state that would disagree with the automatic choice.

## Consequences

Limits are polled snapshots, so the hub can switch somewhat late or early. Profiles that select the same account share its allowance, so one profile's use can move another to a different account. Switching spends a different subscription without asking; the account in use is always marked. A profile with only signed-out accounts at a provider still cannot run that provider's harness.
