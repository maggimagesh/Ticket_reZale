import { cp, mkdir, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = resolve(projectRoot, 'api');
const destination = resolve(projectRoot, 'catalyst/functions/tickets-api/api');

// This is a generated deployment bundle. The source of truth stays in /api,
// so Vercel and Catalyst always execute identical business logic.
await rm(destination, { recursive: true, force: true });
await mkdir(resolve(destination, '..'), { recursive: true });
await cp(source, destination, { recursive: true });
