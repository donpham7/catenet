import { isValidEmail } from "../validation/email.ts";

export function subscribable(emails: string[]): string[] {
  return emails.filter((email) => isValidEmail(email));
}
