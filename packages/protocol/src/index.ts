import type { z } from 'zod';
import { machineMethods, type MachineEvents } from './machine.js';
import { harnessMethods } from './harnesses.js';
import { modelMethods, type ModelEvents } from './models.js';
import { hubMethods } from './hub.js';
import { profileMethods, type ProfileEvents } from './profiles.js';
import { projectMethods, type ProjectEvents } from './projects.js';
import { threadMethods, type ThreadEvents } from './threads.js';

export * from './rpc.js';
export * from './machine.js';
export * from './hub.js';
export * from './harnesses.js';
export * from './models.js';
export * from './profiles.js';
export * from './projects.js';
export * from './threads.js';
export * from './media.js';

export const methods = {
  ...machineMethods,
  ...hubMethods,
  ...harnessMethods,
  ...modelMethods,
  ...profileMethods,
  ...projectMethods,
  ...threadMethods,
};

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type ParamsOf<M extends MethodName> = z.input<Methods[M]['params']>;
export type ResultOf<M extends MethodName> = Methods[M]['result'];

/** Server-pushed events and their payloads. */
export type Events = MachineEvents & ProfileEvents & ProjectEvents & ThreadEvents & ModelEvents;
export type EventName = keyof Events;

export const DEFAULT_PORT = 47321;
