import bcrypt from "bcryptjs";

const ROUNDS = 11;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export function verifyPassword(plain: string, hash: string | null | undefined): Promise<boolean> {
  // Compare against a dummy hash when the user has no password, to keep timing uniform.
  return bcrypt.compare(plain, hash ?? "$2b$11$C6UzMDM.H6dfI/f/IKcEeO5wRk1Mrt3o6V9pSxFZtuYdRW8qQb9m.");
}

export function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 10) return "Password must be at least 10 characters";
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) return "Password must contain letters and numbers";
  return null;
}
