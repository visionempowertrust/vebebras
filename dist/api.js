const projectUrl = "https://echetmjifxcznzsrrnrz.supabase.co";
const publishableKey = "sb_publishable_6IrZajpmKg-V4IgMbyy_-g_ZohTvZbM";
const authKey = "ve.quiz.admin.passcode";

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

async function request(path, { body, keepalive = false } = {}) {
  const headers = { apikey: publishableKey, "Content-Type": "application/json" };
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const response = await fetch(`${projectUrl}${path}`, {
    method: "POST", headers, body: payload, keepalive: keepalive && (payload?.length ?? 0) < 30_000,
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
  session = value;
  writeStorage(authKey, session);
}

export function signedIn() {
  if (!session) return false;
  if (session.token && Date.parse(session.expires_at) > Date.now()) return true;
  setSession(null);
  return false;
}

export async function signIn(password) {
  try {
    setSession(await request("/rest/v1/rpc/quiz_admin_login", { body: { p_passcode: password } }));
  } catch (error) {
    if (error.code === "PGRST202") error.code = "quiz_admin_passcode_unset";
    throw error;
  }
}

export async function signOut() {
  const token = session?.token;
  setSession(null);
  if (token) {
    await request("/rest/v1/rpc/quiz_admin_logout", { body: { p_session_token: token }, keepalive: true }).catch(() => {});
  }
}

export async function rpc(name, body = {}, { admin = false, keepalive = false } = {}) {
  const path = `/rest/v1/rpc/${name}`;
  if (!admin) return request(path, { body, keepalive });
  if (!signedIn()) throw new Error("quiz_sign_in");
  const current = session;
  try {
    return await request(path, { body: { ...body, p_session_token: current.token }, keepalive });
  } catch (error) {
    if (error.status === 401 && session === current) setSession(null);
    throw error;
  }
}
