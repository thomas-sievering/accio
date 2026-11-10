/**
 * A refusal the Sorting Hat explains to its caller: the message is safe to show,
 * and `status` is the HTTP status the management API answers with.
 */
export class HatError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 = 400) { super(message); }
}
