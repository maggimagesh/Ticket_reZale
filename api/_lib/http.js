export function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}

export function allowMethods(req, res, methods) {
  const allowed = methods.map((m) => m.toUpperCase());
  res.setHeader('Allow', allowed.join(', '));
  if (!allowed.includes((req.method || '').toUpperCase())) {
    sendError(res, 405, 'Method not allowed');
    return false;
  }
  return true;
}

export function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function normalizeUsername(value) {
  return String(value || '')
    .trim()
    .toLowerCase();
}

export function validateUsernameFormat(username) {
  if (username.length < 3) return 'Must be at least 3 characters';
  if (!/^[a-z0-9._]+$/.test(username)) {
    return 'Letters, numbers, dots and underscores only';
  }
  return null;
}
