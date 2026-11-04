import type { SystemPromptView } from '@accio/protocol';
import { HARNESSES } from '@accio/hub';

/** Who the prompt is for. Extend this when a section needs more, such as the thread's profile. */
export type SystemPromptTarget = {
  harnessId: string;
  /** The model id the harness runs; omitted when the harness picks its own default. */
  model?: string;
  /** Its display name, when known. */
  modelName?: string;
  platform?: NodeJS.Platform;
};

type SystemPromptContext = Required<Pick<SystemPromptTarget, 'harnessId' | 'platform'>> & SystemPromptTarget & { harnessName: string };

type Section = {
  id: string;
  title: string;
  /** Harnesses that get this section; all of them when omitted. */
  harnesses?: string[];
  text: (ctx: SystemPromptContext) => string;
};

/** Stand in for per-turn values in Settings, where no turn is running. */
export const PLACEHOLDERS = { harness: '{harness}', model: '{model}' } as const;

/**
 * GLOSSARY: System prompt. Accio's additions to each harness's own instructions,
 * in order. Add a section here to tell every harness something new; limit it with
 * `harnesses`, or vary its wording with the context. Keep it short: every turn
 * carries it.
 */
const SECTIONS: Section[] = [
  {
    id: 'accio',
    title: 'Accio',
    text: () => "You are working in a thread in Accio, a desktop app. The user reads your replies in Accio's chat window, not a terminal: GitHub-flavored Markdown renders fully, and tool calls show as collapsible rows, so don't repeat their output.",
  },
  {
    id: 'runtime',
    title: 'Runtime',
    text: ({ harnessName, model, modelName }) => {
      const label = modelName && model && modelName !== model ? `${modelName} (model id: ${model})` : (model ?? modelName);
      return `In case you're asked: you are running in Accio through the ${harnessName} harness${label ? `, as ${label}` : ''}. No need to mention this otherwise.`;
    },
  },
  {
    id: 'media',
    title: 'Inline media',
    text: ({ platform }) => `The chat shows images, video and audio inline. Embed them with Markdown image syntax and an absolute path, a path relative to the working directory, or an https URL: ![Chart](${exampleDir(platform)}/chart.png). Wrap paths containing spaces in angle brackets. SVG isn't shown inline, so convert it to PNG first. When a picture, chart, diagram or screenshot would help, create the file and embed it. Never say images can't be shown here.`,
  },
  {
    id: 'choices',
    title: 'UI choices',
    text: () => [
      'When the user asks you to prototype, try, mock up or propose UI for a feature, or asks for variants, build two to four genuinely different versions and show them with the offer_choice tool so the user can pick one. This is for a feature or component, not for designing a whole app.',
      '- Screenshot only what the options change: the element or region with a little surrounding context, never the whole window or page. Capture every option at the same size, with the same data and state, so they compare fairly.',
      '- Label each option in a few words by what makes it different, and ask one short question, such as "Which empty state?".',
      '- After offer_choice, end your turn. Don\'t embed the same images again; at most add a sentence on the main trade-off.',
      'The user\'s next message starts with their pick, such as `I pick B ("Inline banner")`, and may add feedback. Continue from that option. To show a single result rather than ask for a decision, embed the image inline instead.',
    ].join('\n'),
  },
  {
    id: 'files',
    title: 'File links',
    text: ({ platform }) => `Link any other file you produce by its absolute path, such as [report.pdf](${exampleDir(platform)}/report.pdf), so the user can download it.`,
  },
];

const DELIVERY: Record<string, string> = {
  claudeCode: "Appended to Claude Code's built-in system prompt.",
  codex: "Sent as developer instructions, alongside Codex's built-in instructions.",
};

function exampleDir(platform: NodeJS.Platform) {
  return platform === 'win32' ? 'C:/work' : '/home/me/work';
}

function sectionsFor(target: SystemPromptTarget, harnessName?: string) {
  const ctx: SystemPromptContext = {
    ...target,
    platform: target.platform ?? process.platform,
    harnessName: harnessName ?? HARNESSES.find((h) => h.id === target.harnessId)?.name ?? target.harnessId,
  };
  return SECTIONS.filter((s) => !s.harnesses || s.harnesses.includes(ctx.harnessId)).map((s) => ({ id: s.id, title: s.title, text: s.text(ctx) }));
}

/** The text a harness receives: its sections, titled, in order. */
export function systemPromptText(target: SystemPromptTarget): string {
  return sectionsFor(target).map((s) => `# ${s.title}\n\n${s.text}`).join('\n\n');
}

/**
 * The whole system prompt across harnesses, as Settings shows it: each section
 * once, with placeholders for the turn's harness and model. Sections whose text
 * still differs between harnesses get one variant per distinct text.
 */
export function systemPromptView(harnesses: readonly { id: string; name: string }[], platform: NodeJS.Platform = process.platform): SystemPromptView {
  const sent = harnesses.map((h) => ({ id: h.id, sections: sectionsFor({ harnessId: h.id, model: PLACEHOLDERS.model, platform }, PLACEHOLDERS.harness) }));
  return {
    harnesses: harnesses.map((h) => ({ id: h.id, name: h.name, delivery: DELIVERY[h.id] ?? 'Added to the harness instructions.' })),
    sections: SECTIONS.flatMap(({ id, title }) => {
      const variants: { harnessIds: string[]; text: string }[] = [];
      for (const h of sent) {
        const text = h.sections.find((s) => s.id === id)?.text;
        if (text === undefined) continue;
        const same = variants.find((v) => v.text === text);
        if (same) same.harnessIds.push(h.id);
        else variants.push({ harnessIds: [h.id], text });
      }
      return variants.length ? [{ id, title, variants }] : [];
    }),
  };
}
