import { z } from 'zod';
import { method } from './rpc.js';
import type { ProviderId } from './profiles.js';

/** GLOSSARY: Harness. Which ones exist is a shared setting; each machine reports which it has. */
export type HarnessView = {
  id: string;
  name: string;
  /** The providers whose models it can use. */
  providers: ProviderId[];
  /** The machines that have it installed. */
  machines: { machineId: string; version: string | null }[];
};

export const harnessMethods = {
  'harnesses.list': method<z.ZodObject<{}>, HarnessView[]>(z.object({})),
};
