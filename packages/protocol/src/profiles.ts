import { z } from 'zod';
import { method } from './rpc.js';

/** GLOSSARY: Profile, as clients see it. Its accounts live on the hub; clients only learn which account is signed in. */
export type ProfileView = {
  id: string;
  name: string;
  /** Folders whose new projects default to this profile, like fleet's roots. */
  roots: string[];
  /** GLOSSARY: Sign-in. Null until the profile is signed in with Claude. */
  signIn: { email: string | null; organization: string | null } | null;
};

export const SaveProfileParams = z.object({
  /** Omit to create. */
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Name is required').max(40),
  roots: z.array(z.string().trim().min(1)).default([]),
});
export type SaveProfileParams = z.output<typeof SaveProfileParams>;

const ById = z.object({ id: z.string() });
const ProfileId = z.object({ profileId: z.string() });
const CompleteSignIn = z.object({ signInId: z.string(), code: z.string().trim().min(1, 'Paste the code from Claude’s page') });

export const profileMethods = {
  'profiles.list': method<z.ZodObject<{}>, ProfileView[]>(z.object({})),
  'profiles.save': method<typeof SaveProfileParams, ProfileView>(SaveProfileParams),
  'profiles.delete': method<typeof ById, null>(ById),
  /** Returns Claude's consent page; open it, approve, and paste the code it shows into completeSignIn. */
  'profiles.beginSignIn': method<typeof ProfileId, { signInId: string; url: string }>(ProfileId),
  'profiles.completeSignIn': method<typeof CompleteSignIn, ProfileView>(CompleteSignIn),
  'profiles.signOut': method<typeof ProfileId, ProfileView>(ProfileId),
};

export type ProfileEvents = {
  'profiles.changed': ProfileView[];
};
