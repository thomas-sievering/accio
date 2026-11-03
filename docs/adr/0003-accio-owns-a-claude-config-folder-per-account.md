# accio owns a Claude config folder per account on each machine

Every thread runs with `CLAUDE_CONFIG_DIR` pointing at a folder accio owns for that account on that machine, and accio rewrites that folder's settings, skills and MCP configuration on every sync. Because logins live on the hub (ADR 0002), the folder holds nothing a person needs to edit, and accio never reads or writes `~/.claude`, so manual Claude Code use on the same machine stays untouched. Edits made by hand inside an accio-owned folder are overwritten.
