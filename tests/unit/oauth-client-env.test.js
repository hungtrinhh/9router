// A deployment on a public domain cannot use the bundled Google clients: they are
// installed-app clients, so Google only accepts loopback redirect URIs for them.
// These env vars let it plug in its own Web application client (with the hosted
// /callback registered) without patching the constants.
import { describe, it, expect, vi } from "vitest";

// src/ imports the engine through the "open-sse/..." specifier, which vitest does
// not resolve. Point those at the real modules so the assertions below still run
// against the shipped registry data instead of a stub.
vi.mock("open-sse/providers/index.js", async () => ({ ...(await import("../../open-sse/providers/index.js")) }));
vi.mock("open-sse/providers/shared.js", async () => ({ ...(await import("../../open-sse/providers/shared.js")) }));
vi.mock("open-sse/shared/zedAuth.js", async () => ({ ...(await import("../../open-sse/shared/zedAuth.js")) }));
vi.mock("open-sse/index.js", () => ({}));

const GOOGLE_ID = "override-google.apps.googleusercontent.com";
const GOOGLE_SECRET = "override-google-secret";
const ANTIGRAVITY_ID = "override-antigravity.apps.googleusercontent.com";
const ANTIGRAVITY_SECRET = "override-antigravity-secret";

// Set before the modules load: the clients are resolved once, at import time.
process.env.GOOGLE_OAUTH_CLIENT_ID = GOOGLE_ID;
process.env.GOOGLE_OAUTH_CLIENT_SECRET = GOOGLE_SECRET;
process.env.ANTIGRAVITY_OAUTH_CLIENT_ID = ANTIGRAVITY_ID;
process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET = ANTIGRAVITY_SECRET;

describe("google oauth client env override", () => {
  it("shared constants take the override", async () => {
    const { GOOGLE_OAUTH_CLIENT, ANTIGRAVITY_OAUTH_CLIENT } = await import("../../open-sse/providers/shared.js");
    expect(GOOGLE_OAUTH_CLIENT).toEqual({ clientId: GOOGLE_ID, clientSecret: GOOGLE_SECRET });
    expect(ANTIGRAVITY_OAUTH_CLIENT).toEqual({ clientId: ANTIGRAVITY_ID, clientSecret: ANTIGRAVITY_SECRET });
  });

  it("registry transports (token refresh) take the override", async () => {
    const gemini = (await import("../../open-sse/providers/registry/gemini.js")).default;
    const geminiCli = (await import("../../open-sse/providers/registry/gemini-cli.js")).default;
    const antigravity = (await import("../../open-sse/providers/registry/antigravity.js")).default;
    expect(gemini.transport.clientId).toBe(GOOGLE_ID);
    expect(gemini.transport.clientSecret).toBe(GOOGLE_SECRET);
    expect(geminiCli.transport.clientId).toBe(GOOGLE_ID);
    expect(geminiCli.transport.clientSecret).toBe(GOOGLE_SECRET);
    expect(antigravity.transport.clientId).toBe(ANTIGRAVITY_ID);
    expect(antigravity.transport.clientSecret).toBe(ANTIGRAVITY_SECRET);
  });

  it("dashboard oauth configs take the override", async () => {
    const { GEMINI_CONFIG, ANTIGRAVITY_CONFIG } = await import("../../src/lib/oauth/constants/oauth.js");
    expect(GEMINI_CONFIG.clientId).toBe(GOOGLE_ID);
    expect(GEMINI_CONFIG.clientSecret).toBe(GOOGLE_SECRET);
    expect(ANTIGRAVITY_CONFIG.clientId).toBe(ANTIGRAVITY_ID);
    expect(ANTIGRAVITY_CONFIG.clientSecret).toBe(ANTIGRAVITY_SECRET);
    // the registry half of the merge must still be there
    expect(GEMINI_CONFIG.authorizeUrl).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(GEMINI_CONFIG.scopes).toContain("https://www.googleapis.com/auth/cloud-platform");
  });

  it("the authorize URLs the dashboard builds carry the override", async () => {
    const { generateAuthData } = await import("../../src/lib/oauth/providers/index.js");
    const geminiCli = await generateAuthData("gemini-cli", "https://router.example.com/callback");
    expect(new URL(geminiCli.authUrl).searchParams.get("client_id")).toBe(GOOGLE_ID);
    const antigravity = await generateAuthData("antigravity", "https://router.example.com/callback");
    expect(new URL(antigravity.authUrl).searchParams.get("client_id")).toBe(ANTIGRAVITY_ID);
  });
});
