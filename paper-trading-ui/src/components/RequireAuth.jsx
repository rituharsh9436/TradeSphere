import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

// Guards app routes: redirects to /login when there is no token.
function RequireAuth({ children }) {
  const { token, loading } = useAuth();
  if (loading) return <div style={{ padding: 20 }}>Loading…</div>;
  if (!token) return <Navigate to="/login" replace />;
  return children;
}

export default RequireAuth;
