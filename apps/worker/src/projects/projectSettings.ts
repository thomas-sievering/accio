import { z } from 'zod';
import { accioTool } from '../tools/tools.js';

/**
 * GLOSSARY: Project setup thread. A thread started from the project dashboard that finds
 * the commands the project app runs with, tries them, and saves them through this tool.
 * Nothing starts on its own afterwards: the dashboard offers Start.
 */
export const PROJECT_SETTINGS_TOOL = 'project_settings';

/** The first message of a Project setup thread; it states the contract the project app runs under. */
export function projectSetupPrompt(projectName: string): string {
  return `Set up the ${projectName} app for Accio's project dashboard

Accio runs this project's app from a fresh checkout of origin's default branch and restarts it on every new commit there. Find the two commands it needs:

- Setup command (optional): run once in a fresh checkout and again after each update before starting, e.g. installing dependencies and building. Leave it empty if nothing is needed.
- Start command: starts the app and keeps running. It must serve HTTP on the port in the PORT environment variable (or the literal {port} in the command, which Accio replaces). Accio opens http://127.0.0.1:<port> as the app. Prefer the command a person would use to try the app locally, not a test, desktop-only or deploy command.

Work it out from the repository (package scripts, README, Makefile, docs). Then prove it in this workspace: run the setup command, start the app with PORT set to a free port, check that it answers on http://127.0.0.1:<port>, and stop it again. Change no project files for this.

When it works, call the ${PROJECT_SETTINGS_TOOL} accio tool once with both commands; that saves them in the project's settings. Then reply with the commands, why you chose them, and anything the person should know (needed secrets, slow first setup). If you cannot make it work, do not call the tool; explain what blocks it instead.`;
}

/** The accio tool, listed only while a Project setup thread's turn runs. */
export function projectSettingsTool(save: (threadId: string, app: { startCommand: string; setupCommand: string }) => Promise<string>, available: (threadId: string) => boolean) {
  return accioTool({
    name: PROJECT_SETTINGS_TOOL,
    description: "Save the project app's setup and start commands in this project's settings, after you have verified they work. The dashboard then offers to start the app.",
    input: {
      startCommand: z.string().trim().min(1).max(2000).describe('Starts the app and keeps running; serves HTTP on $PORT or {port}'),
      setupCommand: z.string().trim().max(2000).describe('Runs before starting in each fresh checkout, e.g. install and build; empty if none'),
    },
    available,
    call: ({ startCommand, setupCommand }, { threadId }) => save(threadId, { startCommand, setupCommand }),
  });
}
