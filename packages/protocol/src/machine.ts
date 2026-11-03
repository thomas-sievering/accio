import { z } from 'zod';
import { method } from './rpc.js';

/** The machine this server controls (see GLOSSARY: Machine). */
export type MachineInfo = {
  name: string;
  platform: string;
  version: string;
};

export const machineMethods = {
  'machine.get': method<z.ZodObject<{}>, MachineInfo>(z.object({})),
};
