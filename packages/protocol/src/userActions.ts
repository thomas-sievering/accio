/**
 * GLOSSARY: User action. Something only you can do outside Accio, such as approving a sign-in on
 * your phone, that a running turn asked for through the needs_you tool. The turn goes on meanwhile;
 * pending, the card offers Done. It ends when the agent or you mark it done, when you send the thread
 * a message, or when its turn ends.
 */
export type UserActionItem = {
  kind: 'userAction';
  id: string;
  turnId: string;
  requestId: string;
  /** What to do, in a few words, such as "Approve the sign-in in Microsoft Authenticator (14)". */
  action: string;
  detail?: string;
  status: 'pending' | 'done' | 'ended';
};

/**
 * GLOSSARY: Inbox. Why a running turn is back with you: a secret request, a confirmation card or a
 * user action waits on you.
 */
export type NeedsYou = 'secret' | 'confirmation' | 'action';
