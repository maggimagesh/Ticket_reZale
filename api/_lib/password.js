import bcrypt from 'bcryptjs';

const ROUNDS = 10;

export async function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Password strength is enforced in the browser: the server receives a PBKDF2
// verifier rather than the password, so it has nothing to judge here.
