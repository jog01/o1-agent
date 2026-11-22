import { describe, expect, it } from "vitest";
import { toGateway } from "../src/metadata.js";

describe("toGateway", () => {
  it("maps ipfs URIs to the gateway", () => {
    expect(toGateway("ipfs://bafkabc")).toBe("https://gateway.pinata.cloud/ipfs/bafkabc");
    expect(toGateway("ipfs://ipfs/bafkabc")).toBe("https://gateway.pinata.cloud/ipfs/bafkabc");
  });
  it("keeps https and rejects other schemes", () => {
    expect(toGateway("https://x.test/a.png")).toBe("https://x.test/a.png");
    expect(toGateway("http://x.test/a.png")).toBeUndefined();
    expect(toGateway("data:image/png;base64,AA")).toBeUndefined();
  });
});

describe("imageUrl", () => {
  it("is absent until the image has been fetched and cached", async () => {
    const { imageUrl } = await import("../src/metadata.js");
    expect(imageUrl("0x0000000000000000000000000000000000000001")).toBeUndefined();
  });
});

describe("readCapped", () => {
  it("returns small bodies and drops ones over the cap", async () => {
    const { readCapped } = await import("../src/metadata.js");
    expect((await readCapped(new Response(new Uint8Array(10)), 16))?.byteLength).toBe(10);
    expect(await readCapped(new Response(new Uint8Array(32)), 16)).toBeNull();
    const big = new Response(new Uint8Array(4), { headers: { "content-length": "999" } });
    expect(await readCapped(big, 16)).toBeNull();
  });
});
