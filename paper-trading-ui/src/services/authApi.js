import api from "./api";

export async function requestRegistrationOtp({ username, email, password }) {
  await api.post("/auth/request-registration-otp", { username, email, password });
}

export async function registerUser({ email, code }) {
  const res = await api.post("/auth/register", { email, code });
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
