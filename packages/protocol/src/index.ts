import type { z } from 'zod';
import { machineMethods } from './machine.js';
import { accountMethods, type AccountEvents } from './accounts.js';
import { projectMethods, type ProjectEvents } from './projects.js';
import { threadMethods, type ThreadEvents } from './threads.js';

export * from './rpc.js';
export * from './machine.js';
export * from './accounts.js';
export * from './projects.js';
export * from './threads.js';

export const methods = {
  ...machineMethods,
  ...accountMethods,
  ...projectMethods,
  ...threadMethods,
};

export type Methods = typeof methods;
export type MethodName = keyof Methods;
export type ParamsOf<M extends MethodName> = z.input<Methods[M]['params']>;
export type ResultOf<M extends MethodName> = Methods[M]['result'];

/** Server-pushed events and their payloads. */
export type Events = AccountEvents & ProjectEvents & ThreadEvents;
export type EventName = keyof Events;

export const DEFAULT_PORT = 47321;
