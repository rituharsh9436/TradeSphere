import axios from "axios";
import { getToken, clearToken } from "../lib/authStorage";

// All backend routes live under /api (see backend routes/index.js).
const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

// Attach the bearer token (if any) to every request.
api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// On 401, drop the (stale) token and bounce to login.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      clearToken();
      if (window.location.pathname !== "/login") window.location.assign("/login");
    }
    return Promise.reject(err);
  }
);

export default api;
