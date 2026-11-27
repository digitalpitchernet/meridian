// Local dev server for the Meridian app (no dependencies).
//   node tools/serve.mjs [port]              -> http://127.0.0.1:5180/ (local PostgreSQL 17 + RLS)
//   node tools/serve.mjs [port] --supabase   -> http://127.0.0.1:5180/ (uses SUPABASE_URL + SUPABASE_ANON_KEY from .env)
//   node tools/serve.mjs [port] --fixtures   -> http://127.0.0.1:5180/ (explicit fictional browser-only fixtures)
// Serves app/ only, on 127.0.0.1 only. Never serves the repository root (.env, docs, tests stay private).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalSupabase } from './local-supabase.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const root = join(repoRoot, 'app');
const args = process.argv.slice(2);
const useFixtures = args.includes('--fixtures');
const useSupabase = args.includes('--supabase');
const portArg = args.find(a => /^\d+$/.test(a));
const port = Number(portArg || process.env.PORT || 5180);
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function loadPublicSupabaseConfig() {
  let url = process.env.SUPABASE_URL;
  let anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    try {
      const envText = readFileSync(join(repoRoot, '.env'), 'utf8');
      for (const line of envText.split(/\r?\n/)) {
        const m = line.match(/^(SUPABASE_URL|SUPABASE_ANON_KEY)=(.+)$/);
        if (m) {
          if (m[1] === 'SUPABASE_URL' && !url) url = m[2].trim();
          if (m[1] === 'SUPABASE_ANON_KEY' && !anonKey) anonKey = m[2].trim();
        }
      }
    } catch { /* .env optional */ }
  }
  if (!url || !anonKey) {
    console.error('Error: SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env or environment for --supabase mode.');
    process.exit(1);
  }
  // Never read or expose SUPABASE_SERVICE_ROLE_KEY in app-config.json
  return {
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    label: 'Supabase · validation',
    description: 'Connected to Supabase via publishable anon key with GoTrue auth and RLS.',
  };
}

const remoteConfig = useSupabase ? loadPublicSupabaseConfig() : null;
const backend = (useFixtures || useSupabase) ? null : createLocalSupabase();
if (backend) {
  try {
    backend.initAndStart();
  } catch (err) {
    console.error(`Error starting local PostgreSQL backend: ${err.message}`);
    process.exit(1);
  }
}

const server = createServer(async (req, res) => {
  try {
    const path = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (backend && (path.startsWith('/auth/v1/') || path.startsWith('/rest/v1/'))) {
      await backend.handleRequest(req, res);
      return;
    }
    if (path === '/app-config.json') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      const payload = remoteConfig || (backend ? {
        supabaseUrl: `http://127.0.0.1:${port}`,
        supabaseAnonKey: 'local-dev-anon',
        label: 'PostgreSQL · live',
        description: 'Connected to local PostgreSQL 17 with migrations, row-level security, and server-side audit logging.',
      } : { mode: 'fixtures' });
      res.end(JSON.stringify(payload));
      return;
    }
    let file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end('forbidden'); return; }
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found');
  }
});

server.listen(port, '127.0.0.1', () => {
  const mode = remoteConfig ? `Supabase (${remoteConfig.supabaseUrl})` : backend ? 'PostgreSQL 17 + RLS' : 'fictional browser fixtures';
  console.log(`Meridian dev server (${mode}): http://127.0.0.1:${port}/  (serving ${root})`);
});

if (backend) {
  const shutdown = () => { server.close(); backend.stop(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
