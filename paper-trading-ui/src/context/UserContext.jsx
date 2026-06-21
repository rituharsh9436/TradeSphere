import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getUser } from "../services/api";

// There is no auth on the backend yet — users are plain UUIDs. We persist the
// active user's id in localStorage and rehydrate their profile on load so the
// whole app can scope its requests to "the current user".

const STORAGE_KEY = "ptu.userId";
const UserContext = createContext(null);

export function UserProvider({ children }) {
  const [userId, setUserId] = useState(() => localStorage.getItem(STORAGE_KEY) || null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(Boolean(userId));
  const [error, setError] = useState(null);

  // Rehydrate / refresh the profile whenever the active id changes. All state
  // updates happen after the awaited fetch (never synchronously in the effect).
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      try {
        const u = await getUser(userId);
        if (cancelled) return;
        setUser(u);
        setError(null);
      } catch {
        if (cancelled) return;
        // Stored id is stale/invalid — drop it so onboarding shows again.
        setError("Saved account could not be loaded.");
        setUser(null);
        localStorage.removeItem(STORAGE_KEY);
        setUserId(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const login = useCallback((id) => {
    localStorage.setItem(STORAGE_KEY, id);
    setLoading(true);
    setUserId(id);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setUserId(null);
    setUser(null);
  }, []);

  const value = { userId, user, loading, error, login, logout, setUser };
  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useUser() {
  const ctx = useContext(UserContext);
  if (!ctx) throw new Error("useUser must be used within a UserProvider");
  return ctx;
}
