export function isValidPhone(phone: string): boolean {
  return /^\+?[0-9 ]{7,15}$/.test(phone.trim());
}
