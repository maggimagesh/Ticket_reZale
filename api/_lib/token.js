import jwt from 'jsonwebtoken';

const DEFAULT_TTL = '7d';
const SHORT_TTL = '1d';

function secret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error('Missing JWT_SECRET');
  return s;
}

export function signToken({ id, username }, { remember = true } = {}) {
  return jwt.sign({ sub: id, username }, secret(), {
    expiresIn: remember ? DEFAULT_TTL : SHORT_TTL,
  });
}

export function verifyToken(token) {
  return jwt.verify(token, secret());
}
