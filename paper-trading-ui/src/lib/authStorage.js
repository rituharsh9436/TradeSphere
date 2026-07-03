// Single source of truth for the persisted auth token. Kept tiny and pure so it
// can be unit-tested and reused by both the axios interceptor and AuthContext.
const TOKEN_KEY = "mlx.token";

function storage() {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

export function getToken() {
  try {
    return storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    const s = storage();
    if (!s) return;
    if (token) s.setItem(TOKEN_KEY, token);
    else s.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable — non-fatal */
  }
}

export function clearToken() {
  setToken(null);
}
