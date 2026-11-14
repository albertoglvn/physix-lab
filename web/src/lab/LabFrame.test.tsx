import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LabFrame,
  NameField,
  StatusDot,
  STUDIES,
  StudySwitch,
  UndoRedo,
} from "./LabFrame";

const noop = () => {};

describe("study switch", () => {
  it("renders one radio per study with only the current one tabbable", () => {
    const html = renderToStaticMarkup(
      <StudySwitch value="stress" onChange={noop} />,
    );
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(STUDIES.length);
    expect(html).toMatch(
      /data-study="stress" aria-checked="true" tabindex="0"/,
    );
    expect(html).toMatch(
      /data-study="motion" aria-checked="false" tabindex="-1"/,
    );
  });
});

describe("top bar controls", () => {
  it("disables undo and redo when there is no history", () => {
    const html = renderToStaticMarkup(
      <UndoRedo canUndo={false} canRedo onUndo={noop} onRedo={noop} />,
    );
    expect(html).toMatch(/aria-label="Undo"[^>]*disabled/);
    expect(html).not.toMatch(/aria-label="Redo"[^>]*disabled/);
  });

  it("labels the name field and the status dot for assistive technology", () => {
    expect(
      renderToStaticMarkup(
        <NameField label="Study name" value="Plate study" onCommit={noop} />,
      ),
    ).toMatch(/aria-label="Study name"[^>]*value="Plate study"/);
    const dot = renderToStaticMarkup(
      <StatusDot label="Solver" value="Offline" tone="warn" />,
    );
    expect(dot).toContain('data-tone="warn"');
    expect(dot).toContain('title="Solver: Offline"');
    expect(dot).toContain("Solver: </span>Offline");
  });
});

describe("lab frame", () => {
  const frame = (active: boolean) =>
    renderToStaticMarkup(
      <LabFrame
        study="motion"
        active={active}
        onStudyChange={noop}
        documentTitle="Incline · Physix"
        title={<span>title</span>}
        controls={<button type="button">Run</button>}
        status={<span>status</span>}
        menu={[{ label: "Home", onSelect: noop }]}
        rail={[{ id: "add", label: "Add part", icon: null, content: () => "" }]}
        railLabel="Parts"
      >
        <div id="stage-content" />
      </LabFrame>,
    );

  it("lays out one top bar, the rail and a single stage", () => {
    const html = frame(true);
    expect(html.match(/<header/g)).toHaveLength(1);
    expect(html.match(/<main/g)).toHaveLength(1);
    expect(html).toContain('aria-label="Parts"');
    expect(html).toContain('aria-label="More actions"');
    expect(html).toContain('href="#/"');
    expect(html).toContain('id="stage-content"');
    expect(html).toContain('aria-label="Motion study"');
    expect(html).not.toMatch(/class="lab-frame"[^>]*hidden/);
  });

  it("hides an inactive study without unmounting it", () => {
    const html = frame(false);
    expect(html).toMatch(/class="lab-frame"[^>]*hidden/);
    expect(html).toContain('id="stage-content"');
  });
});
