# Electron, React and TypeScript in one monorepo; Claude through the Agent SDK

The client is an Electron app with a React UI, and the server is Node; both are TypeScript in one monorepo with a shared package for the client–server messages. React was chosen over Svelte so that components and patterns can be borrowed from T3 Code (also React), and because coding agents write it most reliably. Claude runs through `@anthropic-ai/claude-agent-sdk`, as in T3 Code; Codex and pi come later.
