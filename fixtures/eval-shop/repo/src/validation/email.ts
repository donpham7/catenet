export function isValidEmail(email: string): boolean {
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.includes("@") && !trimmed.startsWith("@") && !trimmed.endsWith("@");
}
