import api from "./api";

export async function registerUser({ username, email, password }) {
  const res = await api.post("/auth/register", { username, email, password });
  return res.data.data; // { user, token }
}

export async function loginUser({ email, password }) {
  const res = await api.post("/auth/login", { email, password });
  return res.data.data; // { user, token }
}

export async function getMe() {
  const res = await api.get("/me");
  return res.data.data.user;
}
