import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUsageStats: vi.fn(),
  getActiveRequests: vi.fn(),
  statsEmitter: {
    on: vi.fn(),
    off: vi.fn(),
  },
}));

vi.mock("@/lib/usageDb", () => mocks);

import { GET } from "../../src/app/api/usage/stream/route.js";

afterEach(() => {
  vi.clearAllMocks();
});

describe("usage stats stream period", () => {
  it("builds live aggregate snapshots for the requested dashboard period", async () => {
    const stats = { totalCachedTokens: 16896, byModel: {} };
    mocks.getUsageStats.mockResolvedValue(stats);
    mocks.getActiveRequests.mockResolvedValue({ activeRequests: [], recentRequests: [], errorProvider: "" });

    const response = await GET(new Request("http://localhost/api/usage/stream?period=24h"));
    const reader = response.body.getReader();
    const { value } = await reader.read();
    await reader.cancel();

    expect(mocks.getUsageStats).toHaveBeenCalledWith("24h");
    expect(new TextDecoder().decode(value)).toContain('"totalCachedTokens":16896');
  });
});
