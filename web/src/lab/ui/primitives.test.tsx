import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clampDockHeight, Dock, DOCK_MIN_HEIGHT } from "./Dock";
import { FloatingPanel } from "./FloatingPanel";
import {
  isBoolean,
  isFiniteNumber,
  readPreference,
  writePreference,
  type KeyValueStore,
} from "./persist";
import {
  formatQuantity,
  parseQuantity,
  unitFactor,
  validateQuantity,
} from "./quantity";
import { createToastStore } from "./toastStore";
import { ToastViewport } from "./Toast";
import { UnitInput } from "./UnitInput";

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("quantity parsing", () => {
  it("converts typed values to SI using the display unit or a suffix", () => {
    expect(parseQuantity("12", "length", "mm")).toEqual({
      ok: true,
      value: 0.012,
    });
    expect(parseQuantity(" 1,5 m ", "length", "mm")).toEqual({
      ok: true,
      value: 1.5,
    });
    expect(parseQuantity("250 MPa", "stress", "Pa")).toEqual({
      ok: true,
      value: 2.5e8,
    });
    expect(parseQuantity("2e3kN", "force", "N")).toEqual({
      ok: true,
      value: 2e6,
    });
    const angle = parseQuantity("30°", "angle", "deg");
    expect(angle.ok && angle.value).toBeCloseTo(Math.PI / 6, 12);
    expect(parseQuantity("50 %", "ratio", "")).toEqual({
      ok: true,
      value: 0.5,
    });
  });

  it("accepts an unambiguous letter case and rejects an ambiguous one", () => {
    expect(unitFactor("stress", "mpa")).toBe(1e6);
    expect(unitFactor("length", "MM")).toBe(1e-3);
    expect(unitFactor("force", "kn")).toBe(1e3);
    expect(unitFactor("length", "parsec")).toBeUndefined();
  });

  it("rejects text that is not a number and incompatible units", () => {
    expect(parseQuantity("abc", "mass", "kg")).toEqual({
      ok: false,
      error: "Enter a number in kg.",
    });
    expect(parseQuantity("3 mm", "mass", "kg")).toEqual({
      ok: false,
      error: "mm is a length; expected a mass.",
    });
    expect(parseQuantity("3 furlongs", "length", "m")).toEqual({
      ok: false,
      error: 'Unknown unit "furlongs".',
    });
    expect(parseQuantity("1e400", "length", "m").ok).toBe(false);
  });

  it("formats SI values in the display unit with significant figures", () => {
    expect(formatQuantity(0.0125, "length", "mm")).toBe("12.5");
    expect(formatQuantity(2.1e11, "stress", "GPa")).toBe("210");
    expect(formatQuantity(Math.PI / 6, "angle", "deg")).toBe("30");
    expect(formatQuantity(0, "mass", "kg")).toBe("0");
    expect(formatQuantity(1234.5, "mass", "kg", 3)).toBe("1235");
    expect(formatQuantity(3e-9, "length", "m")).toBe("3.00e-9");
    expect(formatQuantity(Number.NaN, "mass", "kg")).toBe("");
  });

  it("names the field, the limit and the unit in range errors", () => {
    const field = {
      label: "Angle",
      dimension: "angle" as const,
      unit: "deg",
      min: (5 * Math.PI) / 180,
      max: (55 * Math.PI) / 180,
    };
    expect(validateQuantity("60", field)).toEqual({
      ok: false,
      error: "Angle must be between 5 and 55 deg.",
    });
    expect(validateQuantity("20", field).ok).toBe(true);
    expect(
      validateQuantity("-1", {
        label: "Mass",
        dimension: "mass",
        unit: "kg",
        min: 0.1,
      }),
    ).toEqual({ ok: false, error: "Mass must be at least 0.1 kg." });
    expect(
      validateQuantity("30", {
        label: "Mass",
        dimension: "mass",
        unit: "kg",
        max: 20,
      }),
    ).toEqual({ ok: false, error: "Mass must be at most 20 kg." });
  });
});

describe("layout preferences", () => {
  it("round-trip valid values and fall back on missing or invalid ones", () => {
    const store = memoryStore();
    expect(readPreference("panel", true, isBoolean, store)).toBe(true);
    writePreference("panel", false, store);
    expect(store.data.get("physix.lab.ui.panel")).toBe("false");
    expect(readPreference("panel", true, isBoolean, store)).toBe(false);
    store.setItem("physix.lab.ui.height", '"tall"');
    expect(readPreference("height", 280, isFiniteNumber, store)).toBe(280);
    store.setItem("physix.lab.ui.broken", "{");
    expect(readPreference("broken", 1, isFiniteNumber, store)).toBe(1);
  });

  it("survive storage that is missing or throws", () => {
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(readPreference("x", 3, isFiniteNumber, throwing)).toBe(3);
    expect(() => writePreference("x", 4, throwing)).not.toThrow();
    expect(readPreference("x", 3, isFiniteNumber, null)).toBe(3);
  });
});

describe("FloatingPanel", () => {
  it("renders a labelled region docked to its anchor", () => {
    const html = renderToStaticMarkup(
      <FloatingPanel title="Inspector" anchor="right">
        <p>Body</p>
      </FloatingPanel>,
    );
    expect(html).toContain('<section id="');
    expect(html).toContain('class="px-panel px-anchor-right"');
    expect(html).toContain('aria-label="Inspector"');
    expect(html).toContain('aria-label="Collapse Inspector"');
    expect(html).toContain("<p>Body</p>");
  });

  it("collapses to an edge tab without rendering its content", () => {
    const html = renderToStaticMarkup(
      <FloatingPanel title="Probes" anchor="left" defaultCollapsed>
        <p>Body</p>
      </FloatingPanel>,
    );
    expect(html).toContain('class="px-edge-tab px-anchor-left"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Body");
  });

  it("restores the collapsed state remembered for its key", () => {
    const store = memoryStore();
    store.setItem("physix.lab.ui.panel.inspector.collapsed", "true");
    vi.stubGlobal("localStorage", store);
    const html = renderToStaticMarkup(
      <FloatingPanel title="Inspector" anchor="right" persistKey="inspector">
        <p>Body</p>
      </FloatingPanel>,
    );
    expect(html).toContain("px-edge-tab");
    expect(html).not.toContain("Body");
  });
});

describe("Dock", () => {
  it("clamps its height between the minimum and a fraction of the window", () => {
    expect(clampDockHeight(120, 1000)).toBe(DOCK_MIN_HEIGHT);
    expect(clampDockHeight(450.4, 1000)).toBe(450);
    expect(clampDockHeight(900, 1000)).toBe(600);
    expect(clampDockHeight(900, 1000, 0.45)).toBe(450);
    expect(clampDockHeight(500, 250)).toBe(DOCK_MIN_HEIGHT);
    expect(clampDockHeight(Number.NaN, 1000)).toBe(DOCK_MIN_HEIGHT);
  });

  it("shows one summary line while collapsed", () => {
    const html = renderToStaticMarkup(
      <Dock title="Data" summary="t 1.25 s · v 3.18 m/s">
        <p>Plot</p>
      </Dock>,
    );
    expect(html).toContain('aria-label="Data"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("t 1.25 s · v 3.18 m/s");
    expect(html).toContain("Expand Data");
    expect(html).not.toContain("Plot");
    expect(html).not.toContain('role="separator"');
  });

  it("shows a keyboard-resizable handle and its content when open", () => {
    const html = renderToStaticMarkup(
      <Dock title="Data" summary="Ready" defaultOpen defaultHeight={320}>
        <p>Plot</p>
      </Dock>,
    );
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="320"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain("height:min(320px, 60vh)");
    expect(html).toContain("<p>Plot</p>");
  });
});

describe("toasts", () => {
  it("auto-dismiss after the duration except errors", () => {
    vi.useFakeTimers();
    const store = createToastStore({ duration: 5000 });
    const listener = vi.fn();
    store.subscribe(listener);
    store.push({ tone: "ok", message: "Run saved." });
    const error = store.push({ tone: "bad", message: "Solve failed." });
    expect(store.getSnapshot().map((t) => t.message)).toEqual([
      "Run saved.",
      "Solve failed.",
    ]);
    vi.advanceTimersByTime(5000);
    expect(store.getSnapshot().map((t) => t.id)).toEqual([error]);
    store.dismiss(error);
    expect(store.getSnapshot()).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("keep at most the limit and drop the oldest first", () => {
    vi.useFakeTimers();
    const store = createToastStore({ limit: 2 });
    ["a", "b", "c"].forEach((message) => store.push({ tone: "info", message }));
    expect(store.getSnapshot().map((t) => t.message)).toEqual(["b", "c"]);
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("ignore dismissing an unknown toast and stop notifying after unsubscribe", () => {
    const store = createToastStore();
    const listener = vi.fn();
    const stop = store.subscribe(listener);
    store.dismiss(42);
    expect(listener).not.toHaveBeenCalled();
    stop();
    store.push({ tone: "bad", message: "x" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("render errors as alerts and other tones as status messages", () => {
    const store = createToastStore();
    store.push({ tone: "bad", message: "Solver unavailable." });
    store.push({
      tone: "warn",
      message: "Fell back to FEM.",
      action: { label: "Details", run: () => {} },
    });
    const html = renderToStaticMarkup(<ToastViewport store={store} />);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('class="px-toast px-tone-bad" role="alert"');
    expect(html).toContain('class="px-toast px-tone-warn" role="status"');
    expect(html).toContain(">Details</button>");
    expect(html.match(/aria-label="Dismiss"/g)).toHaveLength(2);
    store.clear();
  });
});

describe("UnitInput", () => {
  it("shows the SI value in its display unit with a labelled unit", () => {
    const html = renderToStaticMarkup(
      <UnitInput
        label="Hole radius"
        dimension="length"
        unit="mm"
        value={0.0125}
        onCommit={() => {}}
      />,
    );
    expect(html).toContain("Hole radius");
    expect(html).toContain(" (mm)");
    expect(html).toContain('value="12.5"');
    expect(html).toContain('inputMode="decimal"');
    expect(html).not.toContain("aria-invalid");
  });
});
