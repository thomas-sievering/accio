# Private secrets are held by the Hub and remembered for a project

A harness asks for a credential through Accio's `request_secret` tool, identified by a stable purpose containing its service, operation and account/target. The machine binds the request to its actual thread, turn, profile and project. A permitted saved match is delivered immediately; it never creates a confirmation card. Missing credentials show private input with Save & use, Use once and Decline. A user may also assign a same-profile saved credential to a project once.

Save & use stores the value on the Hub, with metadata authorizing that purpose in the current project. The project identity survives checkout paths and harness sessions. Use once creates no stored credential. Settings / Secrets manages metadata, project access, replacement and deletion through a write-only value API. There is no tool or client method for reading saved values. Explicit profile-wide access includes No project threads; ordinary project access does not. Profiles cannot be deleted while they hold secrets.

The first release delivers a short-lived private file on the machine running the turn. Both harnesses receive only its path. A file is removed when the turn ends, after 15 minutes, or when its saved value/version/access is invalidated. Startup removes orphaned deliveries and interrupted requests become cancelled. File delivery keeps values out of the initial conversation but commands can read, copy or print them under ADR 0005; this is not OS isolation. Local download and media routes reject Hub and delivery paths.

The Hub encrypts saved values with AES-256-GCM and authenticated secret/profile/version identity. The store is separate from shared settings. Windows protects the master key using current-user DPAPI and uses verified owner-only directory ACLs. Headless/other-platform deployments supply a 32-byte base64 master key through the service environment, outside the store; it is never inherited by a harness. No plaintext fallback is offered. Key loss prevents decrypting saved values; DPAPI restoration needs the Windows identity/system, while a provisioned key must be backed up separately. Existing provider-account storage is unchanged.

Claude uses an SDK MCP server bound to the turn. New Codex sessions register a dynamic tool in the pinned app-server protocol. Resumed Codex sessions also receive an authenticated loopback MCP endpoint because app-server cannot add dynamic tools to an old thread; the endpoint closes with the turn. Its key grants only that thread's credential tool and is separate from model-proxy and pairing keys. The Hub never starts a harness or executes a shell command (ADR 0009).

## Considered options

- Asking for confirmation on every saved use adds friction without new information. A project binding authorizes subsequent uses within its scope; only widening access needs a user choice.
- Remembering credentials only in chat or harness config loses the choice across threads and duplicates values across machines. The Hub is the durable owner.
- Automatically saving every pasted token hides persistence. Save & use states that choice explicitly; Use once remains available.
- Storing plaintext beside shared settings risks distributing it or committing it to settings history. Values and key material use separate storage and transport.

## Consequences

Metadata/status alone enters transcripts, copied transcripts, events and Settings responses. Concurrent answers are claimed once; retries do not duplicate deliveries. Changing/deleting a secret removes future access and attempts to remove active copies, but cannot recall values held by an external process or revoke them at their service. Network or unlock errors do not cause another request to paste the same credential.

The current in-process Hub is a deployment boundary, not OS isolation from a same-user full-access harness. Remote pairing/relay is not implemented by this feature. Opaque one-use references and external vaults can be added when a registered operation exists that consumes them inside trusted service code.
