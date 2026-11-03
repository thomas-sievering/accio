# Threads run with full permissions

Every thread runs its harness with all tool permissions granted, with no approval prompts. Approval prompts are a large amount of UI and protocol work, and accio only runs on machines you own. The protection is at the edges instead: only paired machines and clients can start threads (ADR 0001), and the work VM never runs accio.
