import axios from "axios";

// All backend routes live under /api (see backend routes/index.js).
const api = axios.create({
  baseURL: "http://localhost:5000/api",
});

export default api;
