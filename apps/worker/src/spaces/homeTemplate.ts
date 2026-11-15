/** A project of the space as the home's template names it. */
export type TemplateProject = { name: string; key: string };

/** The project's wiki page, one per project, named after it and unique within the space. */
function wikiPages(projects: TemplateProject[]): Map<TemplateProject, string> {
  const pages = new Map<TemplateProject, string>();
  const used = new Set<string>();
  for (const project of projects) {
    const base = project.name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|-+$/g, '') || 'project';
    let file = `${base}.md`;
    for (let n = 2; used.has(file.toLowerCase()); n++) file = `${base}-${n}.md`;
    used.add(file.toLowerCase());
    pages.set(project, `wiki/${file}`);
  }
  return pages;
}

/**
 * GLOSSARY: Home. The files of a new home, built into Accio (#202): AGENTS.md with a short section per
 * project of the space and how to change the home, GLOSSARY.md, docs/adr/, a wiki page per project and the
 * harness-neutral `.agents/skills/` folder. The starter thread fills in what this leaves open.
 */
export function homeTemplate(space: string, projects: TemplateProject[]): Record<string, string> {
  const pages = wikiPages(projects);
  const sections = projects.length
    ? projects.map((p) => `### ${p.name}\n\n\`${p.key}\` · [${pages.get(p)}](${pages.get(p)})\n\n_Not written yet: what it is, how it relates to the other projects, and where to start reading._\n`).join('\n')
    : '_No other projects in the space yet._\n';
  const files: Record<string, string> = {
    'AGENTS.md': `# ${space}

This is the home of the space "${space}" in Accio. It holds what applies to every project in the space. Accio gives this file to every thread in the space's other projects as space-wide context; where it conflicts with a project's own AGENTS.md, the project's own instructions win.

- [GLOSSARY.md](GLOSSARY.md): terms shared across the projects.
- [docs/adr/](docs/adr): decisions that span more than one project.
- [wiki/](wiki): a page per project.
- [.agents/skills/](.agents/skills): skills for work across the space.

## Projects

Each thread's Space section lists these projects with their checkout on its machine. Read a sibling's own AGENTS.md and README there before changing anything that touches it.

${sections}
## Updating the home

- A thread in another project of the space never edits this checkout directly. It starts a thread in the home with the \`start_thread\` accio tool, setting \`project\` to the home and writing the change as a complete task. That thread makes the change here and ships it like any other.
- A thread in the home changes these files in its own worktree and ships them through the normal delivery path.
- Keep this file short: it reaches every thread in the space on every turn. Put detail in the wiki, the glossary or an ADR and link to it.
- When a project joins the space, add its section here and its page under \`wiki/\`.
`,
    // Claude Code reads CLAUDE.md, Codex reads AGENTS.md: one source for both.
    'CLAUDE.md': 'Follow [AGENTS.md](AGENTS.md).\n',
    'GLOSSARY.md': `# Glossary

Terms shared across the projects of ${space}. One entry per term: the word in bold, what it means here, and the words to avoid for it.

<!-- **Term**:
What it means across the space.
_Avoid_: other words for it -->
`,
    'docs/adr/README.md': `# Decisions

Architecture decisions that span more than one project of ${space}, one file per decision: \`NNNN-short-title.md\`, with the context, the decision and the options considered. A decision about one project belongs in that project's own repository.
`,
    'wiki/README.md': `# Wiki

A page per project of ${space}:

${projects.length ? projects.map((p) => `- [${p.name}](${pages.get(p)!.slice('wiki/'.length)})`).join('\n') : '- None yet.'}
`,
    '.agents/skills/README.md': `# Skills

Skills for work across ${space}, one folder per skill with a \`SKILL.md\`. This is the harness-neutral skills folder; don't add a \`.claude/skills/\` copy.
`,
  };
  for (const project of projects) {
    files[pages.get(project)!] = `# ${project.name}

\`${project.key}\`

_Not written yet._

## What it is

## How it relates to the other projects

## Where to start reading
`;
  }
  return files;
}

/**
 * GLOSSARY: Home. The first message of a new home's first thread: read the siblings through the Space
 * section, fill in the template's per-project parts and the glossary, and ship it as usual.
 */
export function starterPrompt(space: string, projects: TemplateProject[]): string {
  const names = projects.map((p) => p.name).join(', ');
  return `This is the new home of the space "${space}". Accio just created it from its home template: AGENTS.md, GLOSSARY.md, docs/adr/, wiki/ with a page per project, and .agents/skills/.

Fill it in from the space's projects${names ? ` (${names})` : ''}:

1. Read each project through the Space section of your instructions: its checkout path on this machine, then its AGENTS.md (or CLAUDE.md) and README. A project the Space section lists as not on this machine can't be read here; leave its parts as they are and say so.
2. In AGENTS.md, replace each project's placeholder with a short section: what it is, how it relates to the other projects, and where to start reading. Keep AGENTS.md short, since it reaches every thread in the space on every turn.
3. Write each project's page under wiki/ in more detail.
4. Seed GLOSSARY.md with terms that are used across more than one project, as each project's own docs use them.
5. Don't change the other projects. Ship the change to this home through the normal delivery path, and report anything you couldn't read or weren't sure about.`;
}
