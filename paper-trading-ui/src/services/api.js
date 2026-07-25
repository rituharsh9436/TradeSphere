import axios from "axios";
import { getToken, clearToken } from "../lib/authStorage";

const API_URL = (import.meta.env.VITE_API_URL || "http://localhost:5000").replace(/\/$/, "");

export function getApiBaseUrl() {
  return API_URL;
}

export function getWsUrl() {
  if (!API_URL) return "ws://localhost:5000/ws/market";

  if (API_URL.startsWith("https://")) {
    return `wss://${API_URL.replace(/^https?:\/\//, "")}/ws/market`;
  }

  if (API_URL.startsWith("http://")) {
    return `ws://${API_URL.replace(/^https?:\/\//, "")}/ws/market`;
  }

  return `${API_URL}/ws/market`;
}

export async function checkApiHealth() {
  const res = await fetch(`${API_URL}/api/health`);
  if (!res.ok) {
    throw new Error(`Backend health check failed with status ${res.status}`);
  }
  return res.json();
}

// All backend routes live under /api (see backend routes/index.js).
const api = axios.create({
  baseURL: `${API_URL}/api`,
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
