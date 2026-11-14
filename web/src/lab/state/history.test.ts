import { describe, expect, it } from "vitest";
import {
  continuesEdit,
  pushHistory,
  redoHistory,
  replaceHistory,
  startHistory,
  undoHistory,
} from "./history";
import { isEditable, shortcutFor } from "../shortcuts";

describe("undo history", () => {
  it("undoes and redoes committed states in order", () => {
    let h = startHistory(1);
    h = pushHistory(h, 2);
    h = pushHistory(h, 3);
    expect(h.present).toBe(3);
    h = undoHistory(h);
    h = undoHistory(h);
    expect(h.present).toBe(1);
    expect(undoHistory(h)).toBe(h);
    h = redoHistory(h);
    expect(h).toEqual({ past: [1], present: 2, future: [3] });
  });

  it("drops the redo branch on a new edit and ignores no-op edits", () => {
    let h = pushHistory(pushHistory(startHistory("a"), "b"), "c");
    h = undoHistory(h);
    h = pushHistory(h, "d");
    expect(h).toEqual({ past: ["a", "b"], present: "d", future: [] });
    expect(redoHistory(h)).toBe(h);
    expect(pushHistory(h, "d")).toBe(h);
  });

  it("merges a continued edit into the present step", () => {
    let h = pushHistory(startHistory(0), 1);
    h = replaceHistory(h, 2);
    h = replaceHistory(h, 3);
    expect(h).toEqual({ past: [0], present: 3, future: [] });
    expect(undoHistory(h).present).toBe(0);
    expect(replaceHistory(h, 3)).toBe(h);
    const drag = { group: "drag", time: 1000 };
    expect(continuesEdit(drag, "drag", 1500)).toBe(true);
    expect(continuesEdit(drag, "drag", 1900)).toBe(false);
    expect(continuesEdit(drag, "field", 1100)).toBe(false);
    expect(continuesEdit(drag, undefined, 1100)).toBe(false);
    expect(continuesEdit(null, "drag", 1100)).toBe(false);
  });

  it("keeps at most the limit of past states", () => {
    let h = startHistory(0);
    for (let i = 1; i <= 8; i++) h = pushHistory(h, i, 5);
    expect(h.past).toEqual([3, 4, 5, 6, 7]);
  });
});

describe("shortcuts", () => {
  it("maps keys to lab actions", () => {
    expect(shortcutFor({ key: " " })).toBe("run");
    expect(shortcutFor({ key: "." })).toBe("step");
    expect(shortcutFor({ key: "R" })).toBe("reset");
    expect(shortcutFor({ key: "f" })).toBe("frame");
    expect(shortcutFor({ key: "Delete" })).toBe("delete");
    expect(shortcutFor({ key: "Escape" })).toBe("deselect");
    expect(shortcutFor({ key: "z", ctrlKey: true })).toBe("undo");
    expect(shortcutFor({ key: "Z", metaKey: true, shiftKey: true })).toBe(
      "redo",
    );
    expect(shortcutFor({ key: "y", ctrlKey: true })).toBe("redo");
    expect(shortcutFor({ key: "s", ctrlKey: true })).toBeNull();
    expect(shortcutFor({ key: "r", altKey: true })).toBeNull();
    expect(shortcutFor({ key: "R", shiftKey: true })).toBeNull();
  });

  it("stays out of the way while the user types or uses a menu", () => {
    const input = { tagName: "input" };
    expect(isEditable(input)).toBe(true);
    expect(shortcutFor({ key: " ", target: input })).toBeNull();
    expect(shortcutFor({ key: "z", ctrlKey: true, target: input })).toBeNull();
    expect(isEditable({ tagName: "DIV", isContentEditable: true })).toBe(true);
    const inMenu = { tagName: "BUTTON", closest: () => ({}) };
    expect(shortcutFor({ key: "Escape", target: inMenu })).toBeNull();
    const button = { tagName: "BUTTON", closest: () => null };
    expect(shortcutFor({ key: " ", target: button })).toBeNull();
    expect(shortcutFor({ key: "r", target: button })).toBe("reset");
    const radio = {
      tagName: "DIV",
      closest: () => null,
      getAttribute: () => "radio",
    };
    expect(shortcutFor({ key: " ", target: radio })).toBeNull();
    const canvas = { tagName: "CANVAS", closest: () => null };
    expect(shortcutFor({ key: " ", target: canvas })).toBe("run");
    expect(isEditable(null)).toBe(false);
  });
});
