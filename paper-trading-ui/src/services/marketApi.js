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

// Trade as the authenticated user — the backend reads the user from the bearer
// token (attached by the axios interceptor), so no userId is sent.
export async function placeOrder({ symbol, side, quantity }) {
  const res = await api.post("/me/orders", { symbol, side, quantity });
  return res.data.data;
}
