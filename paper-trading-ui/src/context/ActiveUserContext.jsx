import { createContext, useContext, useEffect, useState } from "react";

const STORAGE_KEY = "mlx.activeUser";
const ActiveUserContext = createContext(null);

function readStored() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

// Holds the dev "active user" ({ id, username }) used for trading until real
// auth (Step 10). Persisted to localStorage so it survives reloads.
export function ActiveUserProvider({ children }) {
  const [activeUser, setActiveUser] = useState(readStored);

  useEffect(() => {
    if (activeUser) localStorage.setItem(STORAGE_KEY, JSON.stringify(activeUser));
    else localStorage.removeItem(STORAGE_KEY);
  }, [activeUser]);

  return (
    <ActiveUserContext.Provider value={{ activeUser, setActiveUser }}>
      {children}
    </ActiveUserContext.Provider>
  );
}

export function useActiveUser() {
  const ctx = useContext(ActiveUserContext);
  if (!ctx) throw new Error("useActiveUser must be used within ActiveUserProvider");
  return ctx;
}
