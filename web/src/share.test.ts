import { describe, expect, it } from "vitest";
import {
  decodeShare,
  encodeShare,
  MAX_SHARE_BYTES,
  MAX_SHARE_CHARS,
  ShareError,
  shareUrl,
} from "./share";

async function deflate(text: string): Promise<string> {
  const stream = new Blob([text])
    .stream()
    .pipeThrough(new CompressionStream("deflate-raw"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

describe("share codec", () => {
  it("round-trips JSON as unpadded base64url", async () => {
    const value = { a: [1, 2.5, -3e-9], b: "µ ✓", c: null, d: { e: true } };
    const text = await encodeShare(value);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeShare(text)).toEqual(value);
  });

  it("compresses repetitive set-ups well below the link limit", async () => {
    const parts = Array.from({ length: 32 }, (_, i) => ({
      kind: "block",
      x: i,
    }));
    const text = await encodeShare({ parts });
    expect(text.length).toBeLessThan(JSON.stringify({ parts }).length / 2);
  });

  it("refuses to encode a set-up longer than the limit", async () => {
    const noise = Array.from({ length: 12000 }, (_, i) => (i * 7919) % 104729);
    await expect(encodeShare(noise)).rejects.toThrow(/too large/);
  });

  it("rejects malformed, damaged and oversized links", async () => {
    for (const text of ["", "abc$", "a".repeat(MAX_SHARE_CHARS + 1)])
      await expect(decodeShare(text)).rejects.toThrow(/malformed/);
    await expect(decodeShare("AAAA")).rejects.toBeInstanceOf(ShareError);
    const valid = await encodeShare({ ok: true });
    await expect(decodeShare(valid.slice(0, -3))).rejects.toThrow(
      /damaged|incomplete/,
    );
    await expect(decodeShare(await deflate("{not json"))).rejects.toThrow(
      /damaged/,
    );
    // A tiny link that inflates past the output cap.
    const bomb = await deflate(`"${"a".repeat(MAX_SHARE_BYTES * 4)}"`);
    expect(bomb.length).toBeLessThan(MAX_SHARE_CHARS);
    await expect(decodeShare(bomb)).rejects.toThrow(/too much data/);
  });

  it("puts the hash on the page link", () => {
    expect(
      shareUrl("/lab?study=stress&case=abc", "https://site.test/app/#/old"),
    ).toBe("https://site.test/app/#/lab?study=stress&case=abc");
  });
});
