import { describe, it, expect, beforeEach } from "vitest";
import { getToken, setToken, clearToken } from "./authStorage";

// The vitest env is 'node' (no localStorage); install a minimal Map-backed fake
// so we can exercise the helper's read/write/clear delegation.
class FakeStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
}

describe("authStorage", () => {
  beforeEach(() => {
    globalThis.localStorage = new FakeStorage();
  });

  it("round-trips a token", () => {
    expect(getToken()).toBe(null);
    setToken("abc.def.ghi");
    expect(getToken()).toBe("abc.def.ghi");
  });

  it("clears the token", () => {
    setToken("x");
    clearToken();
    expect(getToken()).toBe(null);
  });
});
