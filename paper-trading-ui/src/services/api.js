// src/services/api.js
//
// Central API client for the paper-trading backend. Every backend response is
// wrapped as { status, data, ... }; these helpers unwrap and return the inner
// `data` payload so components can consume it directly.

import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Pull the inner payload out of the standard { status, data } envelope.
const unwrap = (res) => res.data?.data;

// --- Users ---------------------------------------------------------------
export const createUser = (payload) =>
  api.post("/users", payload).then(unwrap);

export const getUser = (id) =>
  api.get(`/users/${id}`).then(unwrap);

export const getWallet = (id) =>
  api.get(`/users/${id}/wallet`).then(unwrap);

export const getPositions = (id) =>
  api.get(`/users/${id}/positions`).then(unwrap);

export const getPortfolio = (id) =>
  api.get(`/users/${id}/portfolio`).then(unwrap);

// --- Market --------------------------------------------------------------
export const getAssets = () =>
  api.get("/assets").then(unwrap);

// --- Orders --------------------------------------------------------------
export const getOrders = (userId) =>
  api.get(`/orders/user/${userId}`).then(unwrap);

export const placeOrder = (data) =>
  api.post("/orders", data).then(unwrap);

// Extracts a human-readable message from an axios error for toast/inline use.
export const errorMessage = (err) =>
  err?.response?.data?.message ||
  err?.message ||
  "Something went wrong. Please try again.";

export default api;
