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
