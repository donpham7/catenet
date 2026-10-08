import { isValidEmail as emailOk } from "../validation/index.ts";

export function inviteErrors(emails: string[]): string[] {
  return emails.filter((email) => !emailOk(email));
}
