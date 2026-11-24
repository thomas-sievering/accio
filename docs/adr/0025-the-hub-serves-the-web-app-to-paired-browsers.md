# The hub serves the web app to paired browsers

The web app, the client you use in a browser (mostly on a phone), is served by the hub at its public URL and talks only to the hub, which relays each call to the machine that owns the thread. No particular machine has to be online for the web app to work. This supersedes ADR 0014's line that the public hub URL is "an API endpoint with setup information, not a remote desktop UI"; the rest of ADR 0014 stands.

A browser is trusted by pairing it as a **client**, a credential separate from a machine's: it cannot join the relay as a machine and can call only what the web app needs. You pair it by scanning a QR code (hub URL plus one-time code) shown in the desktop app, or by typing the code. The credential lives in an HttpOnly, SameSite=Strict cookie on the hub's domain, expires after 30 days without use, and is listed under Paired clients, where any client can unpair it.

The hub stays a relay (ADR 0009): it does not cache machines' thread lists. The browser merges every machine's snapshot itself and keeps the last one per machine for the Offline shelf.

## Considered Options

- **Expose one worker's web client remotely**: almost no new code, but that machine must be online, and its loopback HTTP with one shared token is unsafe to publish.
- **Host the web app elsewhere (e.g. a static site) calling the hub's API**: lets the UI deploy without restarting the hub, but its build can drift from the hub's protocol, it needs CORS, and the credential would sit in script-readable storage. A credential that can start full-permission turns on every machine should not be readable by a script, so the hub serves it.
- **Hub caches each machine's last snapshot**: an offline machine's threads would show on a fresh phone, but the hub would store thread titles and previews, breaking "relays without storing".

## Consequences

- The hub image ships the built web app, so the web app and hub are always the same version; workers on other versions are still reached through the relay's existing protocol checks.
- The hub needs a client role in its trust store and a client entry point to the relay that stamps `from` with the client's id and kind.
- Workers accept a narrower allowlist from a client than from a machine: thread reads and actions, starting a thread, delivery, answers to confirmations, choices and secrets, and read-only shared settings. Never `update.*`, `app.screenshot`, clones or hub writes.
- The web app is the same React app as the desktop client, with a hub transport and a capability flag for having no machine of its own.
- Features that need a machine of the user's own, such as account sign-in, Pick folder and Open app, are not in the web app.
- Image attachments upload through the relay to the machine the message goes to and wait there until it sends, so clients may send `threads.upload` and chunked requests. (Amended 2026-11-24.)
