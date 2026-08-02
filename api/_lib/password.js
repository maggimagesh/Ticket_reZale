import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

const PASSWORD_RULES = [
  { id: 'len', label: 'At least 8 characters', test: (v) => v.length >= 8 },
  { id: 'upper', label: 'One uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'num', label: 'One number', test: (v) => /[0-9]/.test(v) },
  { id: 'sym', label: 'One symbol (!@#$…)', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordMeetsRules(password) {
  return PASSWORD_RULES.every((r) => r.test(password));
}
