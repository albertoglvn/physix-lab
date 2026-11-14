/**
 * Share links (`physix.share/1`): a Motion scene or a Stress case travels in the URL
 * fragment as raw-deflate JSON in unpadded base64url, so opening a link needs no server
 * storage and the payload never reaches the host. See docs/CONTRACTS.md, Share links.
 * `mcp/sites/worker.mjs` writes the same encoding for hosted tool results.
 */

export const SHARE_SCHEMA = "physix.share/1";
/** Longest encoded payload a link may carry. */
export const MAX_SHARE_CHARS = 8192;
/** Largest JSON a payload may inflate to, so a crafted link cannot exhaust memory. */
export const MAX_SHARE_BYTES = 65536;

export class ShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareError";
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function collect(
  stream: ReadableStream<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      void reader.cancel().catch(() => {});
      throw new ShareError("The shared link holds too much data.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

const pipe = (
  bytes: Uint8Array<ArrayBuffer>,
  through: GenericTransformStream,
) =>
  new Blob([bytes]).stream().pipeThrough(through) as ReadableStream<Uint8Array>;

/** Encodes a JSON value for a share link. */
export async function encodeShare(value: unknown): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(value));
  const packed = await collect(
    pipe(json, new CompressionStream("deflate-raw")),
    Number.POSITIVE_INFINITY,
  );
  const text = toBase64Url(packed);
  if (text.length > MAX_SHARE_CHARS)
    throw new ShareError("This set-up is too large to share as a link.");
  return text;
}

/** Decodes a share payload to its JSON value; throws ShareError for anything malformed. */
export async function decodeShare(text: string): Promise<unknown> {
  if (!text || text.length > MAX_SHARE_CHARS || !/^[A-Za-z0-9_-]+$/.test(text))
    throw new ShareError("The shared link is malformed.");
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64Url(text);
  } catch {
    throw new ShareError("The shared link is malformed.");
  }
  let json: Uint8Array;
  try {
    json = await collect(
      pipe(bytes, new DecompressionStream("deflate-raw")),
      MAX_SHARE_BYTES,
    );
  } catch (error) {
    if (error instanceof ShareError) throw error;
    throw new ShareError("The shared link is damaged or incomplete.");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(json));
  } catch {
    throw new ShareError("The shared link is damaged or incomplete.");
  }
}

/** The full link for a lab hash (without `#`), on the current page. */
export function shareUrl(hash: string, base = window.location.href): string {
  const url = new URL(base);
  url.hash = hash;
  return url.toString();
}
