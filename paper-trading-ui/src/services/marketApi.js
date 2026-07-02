import api from "./api";

// Thin, typed-ish wrappers over the backend REST endpoints. Each returns the
// inner `data` payload so callers don't repeat `res.data.data`.

export async function getPrices() {
  const res = await api.get("/market/prices");
  return res.data.data;
}

export async function getCandles({ symbol, interval, from, to }) {
  const res = await api.get("/market/candles", {
    params: { symbol, interval, from, to },
  });
  return res.data.data; // { symbol, intervalSec, candles }
}

export async function getUsers() {
  const res = await api.get("/users");
  return res.data.data;
}

export async function registerUser({ username, email }) {
  const res = await api.post("/users", { username, email });
  return res.data.data;
}

export async function placeOrder({ userId, symbol, side, quantity }) {
  const res = await api.post("/orders", { userId, symbol, side, quantity });
  return res.data.data;
}
