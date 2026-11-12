import { useEffect, useState } from "react";
import { presetNames, type Preset } from "./lab/scene";

/**
 * Hash routes. `#/` is the home page and `#/lab` is the only workspace; its query selects
 * the starting state (LAB_PLAN.md §3.1). Older routes redirect into the lab.
 */

export type Study = "motion" | "stress";
export type StressExample = "plate" | "bracket";
export type LabSheet = "model" | "optimize" | "agent";

export type LabLocation = {
  study: Study;
  template?: Preset;
  example?: StressExample;
  sheet?: LabSheet;
};

export type HashLocation = { path: string; query: URLSearchParams };

const SHEETS: readonly LabSheet[] = ["model", "optimize", "agent"];

export function parseHash(hash: string): HashLocation {
  const raw = hash.replace(/^#/, "") || "/";
  const at = raw.indexOf("?");
  const path = (at < 0 ? raw : raw.slice(0, at)) || "/";
  return {
    path: path.length > 1 ? path.replace(/\/+$/, "") : path,
    query: new URLSearchParams(at < 0 ? "" : raw.slice(at + 1)),
  };
}

const isPreset = (value: string | null | undefined): value is Preset =>
  !!value && Object.hasOwn(presetNames, value);
const isExample = (value: string | null | undefined): value is StressExample =>
  value === "plate" || value === "bracket";
const isSheet = (value: string | null | undefined): value is LabSheet =>
  SHEETS.includes(value as LabSheet);

/** The hash for a lab state, without the leading `#`. */
export function labHash(location: LabLocation): string {
  const query = new URLSearchParams({ study: location.study });
  if (location.study === "motion" && location.template)
    query.set("template", location.template);
  if (location.study === "stress" && location.example)
    query.set("example", location.example);
  if (location.study === "stress" && location.sheet)
    query.set("sheet", location.sheet);
  return `/lab?${query}`;
}

/** Reads the lab query; unknown values fall back to the motion study. */
export function parseLabQuery(query: URLSearchParams): LabLocation {
  const study: Study = query.get("study") === "stress" ? "stress" : "motion";
  const location: LabLocation = { study };
  const template = query.get("template");
  const example = query.get("example");
  const sheet = query.get("sheet");
  if (study === "motion" && isPreset(template)) location.template = template;
  if (study === "stress" && isExample(example)) location.example = example;
  if (study === "stress" && isSheet(sheet)) location.sheet = sheet;
  return location;
}

/**
 * Where an old route now lives, or `null` when the path is current. `#/stress`, the studio
 * routes and the model card open the stress study; `#/lab/<preset>` opens that template.
 */
export function legacyRedirect(path: string): string | null {
  const [, first, second, third] = path.split("/");
  if (first === "lab" && second !== undefined)
    return labHash({
      study: "motion",
      template: isPreset(second) ? second : undefined,
    });
  if (first === "stress" && second === undefined)
    return labHash({ study: "stress" });
  if (first === "model") return labHash({ study: "stress", sheet: "model" });
  if (first === "studio")
    return labHash({
      study: "stress",
      example: isExample(second) ? second : undefined,
      sheet: third === "optimize" ? "optimize" : undefined,
    });
  return null;
}

/** Replaces the current hash without a navigation, so the lab keeps its state. */
export function replaceHash(hash: string): void {
  try {
    window.history.replaceState(window.history.state, "", `#${hash}`);
  } catch {
    // A sandboxed frame can refuse history access; the lab still works.
  }
}

export function useHashLocation(): HashLocation & { hash: string } {
  const read = () => window.location.hash.replace(/^#/, "") || "/";
  const [hash, setHash] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setHash(read());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return { hash, ...parseHash(hash) };
}
