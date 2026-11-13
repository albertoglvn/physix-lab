/**
 * Colours for the three.js viewport. The values live in tokens.css so the 3D view and the
 * HTML around it share one palette; this module only reads them.
 */

export const VIEWPORT_TOKENS = {
  background: "--px-viewport-bg",
  floor: "--px-viewport-floor",
  skyLight: "--px-viewport-sky-light",
  groundLight: "--px-viewport-ground-light",
  sun: "--px-viewport-sun",
  gridMajor: "--px-grid-major",
  gridMinor: "--px-grid-minor",
  block: "--px-part-block",
  blockEdge: "--px-part-block-edge",
  ramp: "--px-part-ramp",
  partEdge: "--px-part-edge",
  frame: "--px-part-frame",
  wheel: "--px-part-wheel",
  rim: "--px-part-rim",
  hub: "--px-part-hub",
  spoke: "--px-part-spoke",
  rope: "--px-part-rope",
  weightLeft: "--px-part-weight-left",
  weightRight: "--px-part-weight-right",
  ball: "--px-part-ball",
  ballBand: "--px-part-ball-band",
  bob: "--px-part-bob",
  coil: "--px-part-coil",
} as const;

export type ViewportPalette = Record<keyof typeof VIEWPORT_TOKENS, string>;

/** Reads every viewport token through `read`; throws when one is missing so a renamed token fails loudly. */
export function readViewportPalette(
  read: (token: string) => string,
): ViewportPalette {
  const palette = {} as ViewportPalette;
  for (const [key, token] of Object.entries(VIEWPORT_TOKENS)) {
    const value = read(token).trim();
    if (!value) throw new Error(`Missing design token ${token}`);
    palette[key as keyof ViewportPalette] = value;
  }
  return palette;
}

/** Palette from the tokens defined on the document root. */
export function documentViewportPalette(): ViewportPalette {
  const style = getComputedStyle(document.documentElement);
  return readViewportPalette((token) => style.getPropertyValue(token));
}
