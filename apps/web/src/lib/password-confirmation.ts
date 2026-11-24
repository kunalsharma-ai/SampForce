/*
 * Password confirmation before destructive actions (workspace redesign W1). The server answers a destructive request
 * that has no fresh confirmation with 403 PASSWORD_CONFIRMATION_REQUIRED; `api()` then asks whoever registered here
 * (the dialog mounted by the app shell, or the Console's) for a one-time pass and sends the request again with it.
 * Kept free of React so `api()` can use it.
 */

export interface ConfirmationRequest {
  method: string;
  path: string;
  /** The server's sentence (asking for the password, or saying the last check expired). */
  message: string;
}

/** Resolves with a one-time pass, or null when the person cancels. */
export type PasswordConfirmationAsker = (request: ConfirmationRequest) => Promise<string | null>;

let asker: PasswordConfirmationAsker | null = null;

export function setPasswordConfirmationAsker(next: PasswordConfirmationAsker | null): void {
  asker = next;
}

export function passwordConfirmationAsker(): PasswordConfirmationAsker | null {
  return asker;
}
