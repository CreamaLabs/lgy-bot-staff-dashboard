const COOKIE_NAME = 'lgy_staff_session';
const STATE_COOKIE = 'lgy_oauth_state';
const SESSION_MAX_AGE = 60 * 60 * 8;
const COMMAND_TYPES = new Set([
  'post_apply_panel', 'post_ticket_panel', 'post_streamer_registration_panel',
  'post_streamer_stats_panel', 'post_streamer_fallback_panel',
  'approve_application', 'deny_application', 'announcement',
  'reset_testing_data',
]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', ...headers } });
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.get('cookie') || '').split(';').map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf('=');
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function base64Url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

async function createSession(user, secret) {
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({
    id: user.id, username: user.username, displayName: user.global_name || user.username,
    avatar: user.avatar, exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  })));
  return `${payload}.${await hmac(payload, secret)}`;
}

async function readSession(request, env) {
  const token = parseCookies(request)[COOKIE_NAME];
  if (!token || !env.SESSION_SECRET) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature || await hmac(payload, env.SESSION_SECRET) !== signature) return null;
  try {
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return session.exp > Math.floor(Date.now() / 1000) ? session : null;
  } catch { return null; }
}

const secureCookie = (name, value, maxAge) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
const clearCookie = (name) => `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
const publicOrigin = (request, env) => (env.PUBLIC_BASE_URL || new URL(request.url).origin).replace(/\/$/, '');

function storeStub(env) {
  return env.STORE.get(env.STORE.idFromName('lgy-primary'));
}

function storeRequest(env, path, init) {
  return storeStub(env).fetch(`https://store.internal${path}`, init);
}

async function handleLogin(request, env) {
  const required = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_GUILD_ID', 'DISCORD_ADMIN_ROLE_IDS', 'SESSION_SECRET'];
  const missing = required.filter((name) => !env[name]);
  if (missing.length) return json({ error: 'Dashboard authentication is not configured.', missing }, 503);
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const redirectUri = `${publicOrigin(request, env)}/auth/callback`;
  const authorize = new URL('https://discord.com/oauth2/authorize');
  authorize.search = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri, scope: 'identify guilds.members.read', state });
  return new Response(null, { status: 302, headers: { location: authorize.toString(), 'set-cookie': secureCookie(STATE_COOKIE, state, 600) } });
}

async function handleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== parseCookies(request)[STATE_COOKIE]) return new Response('Discord sign-in could not be verified.', { status: 400 });
  const redirectUri = `${publicOrigin(request, env)}/auth/callback`;
  const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri }),
  });
  if (!tokenResponse.ok) return new Response('Discord rejected the sign-in request.', { status: 502 });
  const token = await tokenResponse.json();
  const headers = { authorization: `Bearer ${token.access_token}` };
  const [userResponse, memberResponse] = await Promise.all([
    fetch('https://discord.com/api/v10/users/@me', { headers }),
    fetch(`https://discord.com/api/v10/users/@me/guilds/${env.DISCORD_GUILD_ID}/member`, { headers }),
  ]);
  if (!userResponse.ok || !memberResponse.ok) return new Response('You must be a member of the configured Ligaya Street RP server.', { status: 403 });
  const user = await userResponse.json();
  const member = await memberResponse.json();
  const roles = env.DISCORD_ADMIN_ROLE_IDS.split(',').map((value) => value.trim()).filter(Boolean);
  const isOwner = env.DISCORD_OWNER_USER_ID && user.id === env.DISCORD_OWNER_USER_ID;
  if (!isOwner && !member.roles?.some((role) => roles.includes(role))) return new Response('Your Discord account does not have an authorized LGY Bot staff role.', { status: 403 });
  const session = await createSession(user, env.SESSION_SECRET);
  const responseHeaders = new Headers({ location: '/' });
  responseHeaders.append('set-cookie', secureCookie(COOKIE_NAME, session, SESSION_MAX_AGE));
  responseHeaders.append('set-cookie', clearCookie(STATE_COOKIE));
  return new Response(null, { status: 302, headers: responseHeaders });
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function handleApi(request, env, pathname) {
  const session = await readSession(request, env);
  if (!session) return json({ error: 'Sign in with an authorized Discord staff account.' }, 401);
  if (request.method !== 'GET' && !sameOrigin(request)) return json({ error: 'Invalid request origin.' }, 403);
  if (pathname === '/api/session' && request.method === 'GET') return json({ user: session });
  if (pathname === '/api/applications' && request.method === 'GET') return storeRequest(env, '/applications');
  if (pathname === '/api/commands' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    if (!body || !COMMAND_TYPES.has(body.type)) return json({ error: 'Unsupported command.' }, 400);
    if (body.type === 'deny_application' && !String(body.payload?.reason || '').trim()) return json({ error: 'A denial reason is required.' }, 400);
    if (body.type === 'reset_testing_data' && body.payload?.confirmation !== 'RESET TEST DATA') return json({ error: 'Type RESET TEST DATA exactly to authorize the cleanup.' }, 400);
    return storeRequest(env, '/commands', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, requestedBy: session.id, requestedByName: session.displayName }) });
  }
  return json({ error: 'Not found.' }, 404);
}

async function handleBotApi(request, env, pathname) {
  if (!env.BOT_SYNC_SECRET || request.headers.get('authorization') !== `Bearer ${env.BOT_SYNC_SECRET}`) return json({ error: 'Unauthorized bot sync request.' }, 401);
  if (pathname === '/api/sync/applications' && request.method === 'POST') return storeRequest(env, '/applications', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await request.text() });
  if (pathname === '/api/bot/commands' && request.method === 'GET') return storeRequest(env, '/commands/pending');
  const match = pathname.match(/^\/api\/bot\/commands\/([^/]+)\/result$/);
  if (match && request.method === 'POST') return storeRequest(env, `/commands/${encodeURIComponent(match[1])}/result`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await request.text() });
  return json({ error: 'Not found.' }, 404);
}

export class DashboardStore {
  constructor(state) { this.state = state; }
  async fetch(request) {
    const url = new URL(request.url);
    const storage = this.state.storage;
    if (url.pathname === '/applications' && request.method === 'GET') {
      const entries = await storage.list({ prefix: 'app:' });
      const applications = [...entries.values()].sort((a, b) => Number(b.submittedAt || 0) - Number(a.submittedAt || 0));
      return json({ applications, synced: applications.length > 0 });
    }
    if (url.pathname === '/applications' && request.method === 'POST') {
      const body = await request.json();
      const items = Array.isArray(body.applications) ? body.applications : body.application ? [body.application] : [];
      for (const app of items) if (app?.id !== undefined) await storage.put(`app:${app.id}`, { ...app, dashboardSyncedAt: Date.now() });
      return json({ ok: true, count: items.length });
    }
    if (url.pathname === '/commands' && request.method === 'POST') {
      const body = await request.json();
      const command = { id: crypto.randomUUID(), type: body.type, payload: body.payload || {}, requestedBy: body.requestedBy, requestedByName: body.requestedByName, status: 'pending', createdAt: Date.now(), updatedAt: Date.now() };
      await storage.put(`command:${command.id}`, command);
      return json({ ok: true, command });
    }
    if (url.pathname === '/commands/pending' && request.method === 'GET') {
      const now = Date.now();
      const entries = await storage.list({ prefix: 'command:' });
      const pending = [...entries.values()].filter((item) => item.status === 'pending' || (item.status === 'processing' && now - item.updatedAt > 120000)).sort((a, b) => a.createdAt - b.createdAt).slice(0, 5);
      for (const command of pending) { command.status = 'processing'; command.updatedAt = now; await storage.put(`command:${command.id}`, command); }
      return json({ commands: pending });
    }
    const match = url.pathname.match(/^\/commands\/([^/]+)\/result$/);
    if (match && request.method === 'POST') {
      const key = `command:${match[1]}`;
      const command = await storage.get(key);
      if (!command) return json({ error: 'Unknown command.' }, 404);
      const result = await request.json();
      if (command.type === 'reset_testing_data' && result.ok) {
        const applications = await storage.list({ prefix: 'app:' });
        const commands = await storage.list({ prefix: 'command:' });
        const keys = [...applications.keys(), ...commands.keys()].filter((item) => item !== key);
        if (keys.length) await storage.delete(keys);
      }
      await storage.put(key, { ...command, status: result.ok ? 'completed' : 'failed', result, updatedAt: Date.now() });
      return json({ ok: true });
    }
    return json({ error: 'Not found.' }, 404);
  }
}

export default {
  async fetch(request, env) {
    const pathname = new URL(request.url).pathname;
    if (pathname === '/auth/login') return handleLogin(request, env);
    if (pathname === '/auth/callback') return handleCallback(request, env);
    if (pathname === '/auth/logout') return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearCookie(COOKIE_NAME) } });
    if (pathname.startsWith('/api/bot/') || pathname === '/api/sync/applications') return handleBotApi(request, env, pathname);
    if (pathname.startsWith('/api/')) return handleApi(request, env, pathname);
    return env.ASSETS.fetch(request);
  },
};
