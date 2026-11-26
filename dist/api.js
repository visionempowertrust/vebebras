const projectUrl = "https://echetmjifxcznzsrrnrz.supabase.co";
const publishableKey = "sb_publishable_6IrZajpmKg-V4IgMbyy_-g_ZohTvZbM";
const authKey = "ve.quiz.admin";

export function readStorage(key) {
  try { return JSON.parse(sessionStorage.getItem(key)); } catch { return null; }
}

export function writeStorage(key, value) {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The active page can still operate when storage is blocked.
  }
}

let session = readStorage(authKey);
let refreshing;

async function request(path, { body, token, keepalive = false } = {}) {
  const headers = { apikey: publishableKey, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${projectUrl}${path}`, {
    method: "POST", headers, body: payload, keepalive: keepalive && payload.length < 30_000,
    cache: "no-store"
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || data?.msg || data?.error_description || data?.error || "request_failed");
    error.code = data?.code || data?.error_code;
    error.status = response.status;
    throw error;
  }
  return data;
}

function setSession(value) {
  session = value ? {
    access_token: value.access_token,
    refresh_token: value.refresh_token,
    expires_at: value.expires_at || Math.floor(Date.now() / 1000) + value.expires_in
  } : null;
  writeStorage(authKey, session);
}

export function signedIn() {
  return Boolean(session);
}

export async function signIn(email, password) {
  setSession(await request("/auth/v1/token?grant_type=password", { body: { email, password } }));
}

export async function signOut() {
  const token = session?.access_token;
  setSession(null);
  if (token) await request("/auth/v1/logout?scope=local", { token }).catch(() => {});
}

async function adminToken(force = false) {
  if (!session) throw new Error("quiz_sign_in");
  if (!force && session.expires_at * 1000 - Date.now() > 60_000) return session.access_token;
  if (!refreshing) {
    const current = session;
    refreshing = request("/auth/v1/token?grant_type=refresh_token", { body: { refresh_token: current.refresh_token } })
      .then(data => { if (session === current) setSession(data); })
      .catch(error => {
        if (session === current && [400, 401, 403].includes(error.status)) setSession(null);
        throw error;
      })
      .finally(() => { refreshing = null; });
  }
  await refreshing;
  if (!session) throw new Error("quiz_sign_in");
  return session.access_token;
}

export async function rpc(name, body = {}, { admin = false, keepalive = false } = {}) {
  const path = `/rest/v1/rpc/${name}`;
  const token = admin ? await adminToken() : undefined;
  try {
    return await request(path, { body, token, keepalive });
  } catch (error) {
    if (admin && error.status === 401) {
      return request(path, { body, token: await adminToken(true), keepalive });
    }
    throw error;
  }
}
