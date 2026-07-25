/* eslint-disable react-refresh/only-export-components */
// Provider + hook are one cohesive unit (same pattern as the retired
// ActiveUserContext); opt out of the react-refresh export heuristic.
import { createContext, useContext, useEffect, useState } from "react";
import { getToken, setToken } from "../lib/authStorage";
import { loginUser, registerUser, requestRegistrationOtp, getMe } from "../services/authApi";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(getToken);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(getToken()));

  function logout() {
    setToken(null);
    setTokenState(null);
    setUser(null);
  }

  // Hydrate the user from a persisted token. `loading` starts true only when a
  // token is already present (see useState init), so the no-token case needs no
  // synchronous state update here — the effect just fetches the current user.
  useEffect(() => {
    if (!token) return;
    let active = true;
    getMe()
      .then((u) => { if (active) setUser(u); })
      .catch(() => { if (active) logout(); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  function persist({ user: u, token: tk }) {
    setToken(tk);
    setTokenState(tk);
    setUser(u);
  }

  async function login(credentials) {
    persist(await loginUser(credentials));
  }
  async function startRegistration(details) {
    await requestRegistrationOtp(details);
  }
  async function register({ email, code }) {
    persist(await registerUser({ email, code }));
  }

  return (
    <AuthContext.Provider value={{ token, user, loading, login, startRegistration, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
