import type { z } from 'zod';
import { hubMethods, type HubEvents } from './hub.js';
import { limitsMethods, type LimitsEvents } from './limits.js';
import { machineMethods, type MachineEvents } from './machine.js';
import { modelMethods, type ModelEvents } from './models.js';
import { profileMethods, type ProfileEvents } from './profiles.js';
import { projectMethods, type ProjectEvents } from './projects.js';
import { resourceMethods, type ResourceEvents } from './resources.js';
import { secretMethods, type SecretEvents } from './secrets.js';
import { threadMethods, type ThreadEvents } from './threads.js';
import { workspaceSkillMethods } from './workspaceSkills.js';

export * from './hub.js';
export * from './limits.js';
export * from './machine.js';
export * from './media.js';
export * from './models.js';
export * from './profiles.js';
export * from './projects.js';
export * from './relay.js';
export * from './resources.js';
export * from './rpc.js';
export * from './secrets.js';
export * from './shellCommand.js';
export * from './threads.js';
export * from './workspaceSkills.js';

export const methods = {
  ...workspaceSkillMethods,
  ...resourceMethods,
  ...machineMethods,
  ...hubMethods,
  ...modelMethods,
  ...profileMethods,
  ...limitsMethods,
  ...projectMethods,
  ...threadMethods,
  ...secretMethods,
};

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type ParamsOf<M extends MethodName> = z.input<Methods[M]['params']>;
export type ResultOf<M extends MethodName> = Methods[M]['result'];

/** Server-pushed events and their payloads. */
export type Events = MachineEvents & ProfileEvents & LimitsEvents & ProjectEvents & ThreadEvents & ModelEvents & SecretEvents & ResourceEvents & HubEvents;
export type EventName = keyof Events;

export const DEFAULT_PORT = 47321;
