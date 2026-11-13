import type { Case } from "../physics/case";
import { parseCase } from "../physics/parseCase";
import { labHash, type LabLocation } from "../routes";
import { decodeShare, encodeShare, shareUrl } from "../share";
import { parseScene, type LabScene } from "./scene";

/** What a share link opens: a validated scene or case, or why the link failed. */
export type SharedStart = { scene?: LabScene; case?: Case; error?: string };

const reason = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Decodes and validates the shared scene or case in a lab location, if it has one. */
export async function loadShared(location: LabLocation): Promise<SharedStart> {
  try {
    if (location.study === "motion" && location.scene)
      return { scene: parseScene(await decodeShare(location.scene)) };
    if (location.study === "stress" && location.case)
      return { case: parseCase(await decodeShare(location.case)) };
  } catch (error) {
    return { error: `The shared link could not be opened: ${reason(error)}` };
  }
  return {};
}

/** A link that reopens this Motion scene. Run results are not included. */
export async function sceneShareUrl(scene: LabScene, base?: string) {
  const encoded = await encodeShare(scene);
  return shareUrl(labHash({ study: "motion", scene: encoded }), base);
}

/** A link that reopens this Stress case. Results are recomputed when it opens. */
export async function caseShareUrl(c: Case, base?: string) {
  const encoded = await encodeShare(c);
  return shareUrl(labHash({ study: "stress", case: encoded }), base);
}
