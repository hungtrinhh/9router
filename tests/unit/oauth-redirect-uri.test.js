// Guards the provider OAuth callback resolver: a hosted dashboard must never be
// sent back to a loopback callback just because the request arrived via a proxy.
import { describe, it, expect, beforeEach, afterEach } from "vitest";

const req = (headers = {}) => ({
  url: "http://127.0.0.1:20128/api/oauth/gemini-cli/authorize",
  headers: { get: (key) => headers[key] ?? null },
});

const { resolveOAuthRedirectUri, toCallbackUrl } = await import("../../src/lib/oauth/utils/redirectUri.js");

const ENV_KEYS = ["OAUTH_REDIRECT_URI", "BASE_URL", "NEXT_PUBLIC_BASE_URL"];
let saved;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveOAuthRedirectUri", () => {
  it("keeps an explicit redirect_uri (codex/xai fixed loopback ports)", () => {
    process.env.OAUTH_REDIRECT_URI = "https://router.example.com/callback";
    expect(resolveOAuthRedirectUri(req(), "http://localhost:1455/auth/callback"))
      .toBe("http://localhost:1455/auth/callback");
  });

  it("prefers OAUTH_REDIRECT_URI over BASE_URL", () => {
    process.env.OAUTH_REDIRECT_URI = "https://router.example.com/callback";
    process.env.BASE_URL = "http://localhost:20128";
    expect(resolveOAuthRedirectUri(req({ host: "internal:20128" }), null))
      .toBe("https://router.example.com/callback");
  });

  it("appends /callback to an env origin and keeps an explicit env path", () => {
    process.env.OAUTH_REDIRECT_URI = "https://router.example.com";
    expect(resolveOAuthRedirectUri(req(), null)).toBe("https://router.example.com/callback");
    process.env.OAUTH_REDIRECT_URI = "https://router.example.com/oauth/done";
    expect(resolveOAuthRedirectUri(req(), null)).toBe("https://router.example.com/oauth/done");
  });

  it("falls back to BASE_URL, then NEXT_PUBLIC_BASE_URL", () => {
    process.env.BASE_URL = "http://localhost:20128";
    expect(resolveOAuthRedirectUri(req({ host: "router.example.com" }), null))
      .toBe("http://localhost:20128/callback");
    delete process.env.BASE_URL;
    process.env.NEXT_PUBLIC_BASE_URL = "http://localhost:20128";
    expect(resolveOAuthRedirectUri(req({ host: "router.example.com" }), null))
      .toBe("http://localhost:20128/callback");
  });

  it("derives the origin from proxy headers, then from Host", () => {
    expect(resolveOAuthRedirectUri(req({ host: "router.example.com", "x-forwarded-proto": "https" }), null))
      .toBe("https://router.example.com/callback");
    expect(resolveOAuthRedirectUri(req({ host: "internal:20128", "x-forwarded-host": "router.example.com", "x-forwarded-proto": "https" }), null))
      .toBe("https://router.example.com/callback");
    expect(resolveOAuthRedirectUri(req({ host: "router.example.com" }), null))
      .toBe("http://router.example.com/callback");
  });

  it("ignores blank or unparsable env values instead of emitting a broken URL", () => {
    process.env.OAUTH_REDIRECT_URI = "   ";
    expect(resolveOAuthRedirectUri(req({ host: "router.example.com" }), null))
      .toBe("http://router.example.com/callback");
    process.env.OAUTH_REDIRECT_URI = "not a url";
    expect(resolveOAuthRedirectUri(req({ host: "router.example.com" }), null))
      .toBe("http://router.example.com/callback");
  });

  it("keeps the legacy loopback default when there is no request and no config", () => {
    expect(resolveOAuthRedirectUri(null, null)).toBe("http://localhost:8080/callback");
  });
});

describe("toCallbackUrl", () => {
  it("normalizes origins and rejects unusable input", () => {
    expect(toCallbackUrl("https://router.example.com/")).toBe("https://router.example.com/callback");
    expect(toCallbackUrl(" https://router.example.com ")).toBe("https://router.example.com/callback");
    expect(toCallbackUrl("")).toBe("");
    expect(toCallbackUrl("/callback")).toBe("");
  });
});
