import { isValidEmail } from "../validation/index.ts";

export interface SignupInput {
  email: string;
  name: string;
}

export function signupErrors(input: SignupInput): string[] {
  const errors: string[] = [];
  if (!input.name.trim()) errors.push("name is required");
  if (!isValidEmail(input.email)) errors.push("email is invalid");
  return errors;
}
