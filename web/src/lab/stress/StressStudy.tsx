import {
  Bot,
  FileBadge,
  Home,
  Keyboard,
  LayoutTemplate,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type { Case } from "../../physics/case";
import {
  exampleBracket,
  examplePlate,
  tractionMagnitude,
  yieldStrength,
} from "../../physics/case";
import { solidMask } from "../../physics/encoding";
import { ModelCard } from "../../pages/ModelCard";
import {
  labHash,
  replaceHash,
  type LabSheet,
  type StressExample,
  type Study,
} from "../../routes";
import { useEngine, useHealth } from "../../state";
import { AgentPanel } from "../../studio/AgentPanel";
import { CaseEditor, PRESETS } from "../../studio/CaseEditor";
import {
  colormapFor,
  FIELD_OPTIONS,
  rangeFor,
  surrogateField,
  useSurrogate,
  type FieldKey,
} from "../../studio/fields";
import { OptimizePanel } from "../../studio/OptimizePanel";
import { VerifyPanel, type VerifyHandle } from "../../studio/VerifyPanel";
import { Badge, Segmented, Spinner, Stat } from "../../ui/controls";
import { Colorbar, FieldView } from "../../ui/FieldView";
import { mm, mpa, ms, pct } from "../../ui/units";
import {
  LabFrame,
  NameField,
  ShortcutsSheet,
  StatusDot,
  UndoRedo,
  useLabPanels,
  type StatusTone,
} from "../LabFrame";
import { useShortcuts } from "../shortcuts";
import { useHistory } from "../state/history";
import { Dock } from "../ui/Dock";
import { FloatingPanel } from "../ui/FloatingPanel";
import type { RailItem } from "../ui/Rail";
import { Sheet } from "../ui/Sheet";
import { toasts } from "../ui/toastStore";
import { stressSummary } from "./summary";
import "./stress.css";

const REASONS: Record<string, string> = {
  out_of_domain: "outside the training domain",
  high_disagreement: "the ensemble members disagree",
  non_finite_prediction: "non-finite prediction",
};

type StressSheet = LabSheet | "keys" | null;

export type StressStudyProps = {
  active: boolean;
  example?: StressExample;
  sheet?: LabSheet;
  onStudyChange: (study: Study) => void;
};

/** Plane-stress analysis of plates and brackets: the former stress studio as one study. */
export function StressStudy({
  active,
  example = "plate",
  sheet: initialSheet,
  onStudyChange,
}: StressStudyProps) {
  const history = useHistory<Case>(() =>
    example === "bracket" ? exampleBracket() : examplePlate(),
  );
  const c = history.value;
  const [name, setName] = useState(
    example === "bracket" ? "L-bracket study" : "Plate study",
  );
  const [field, setField] = useState<FieldKey>("von_mises");
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [sheet, setSheet] = useState<StressSheet>(initialSheet ?? null);
  const panels = useLabPanels();
  const verify = useRef<VerifyHandle>(null);
  const health = useHealth();
  const engine = useEngine();
  const sur = useSurrogate(engine.engine, c);
  const pred = sur.pred;
  const shownCase = sur.forCase ?? c;

  const mask = useMemo(() => solidMask(shownCase), [shownCase]);
  const values = pred ? surrogateField(pred, field) : null;
  const range = useMemo(
    () => (values ? rangeFor(field, values, mask) : { min: 0, max: 1 }),
    [values, field, mask],
  );
  const res = pred?.result;
  const ys = yieldStrength(c);
  const sf = res && ys ? ys / res.hotspot.von_mises : null;
  const kt = res ? res.hotspot.von_mises / tractionMagnitude(c) : null;
  const threshold = engine.engine?.policy.threshold ?? null;

  const edit = (next: Case, group?: string) => {
    setInvalidField(null);
    history.set(next, group);
  };

  const closeSheet = () => {
    setSheet(null);
    if (initialSheet && active)
      replaceHash(labHash({ study: "stress", example }));
  };

  const startVerify = () => {
    panels.setDockOpen(true);
    verify.current?.start();
  };

  useShortcuts(active && sheet === null, {
    undo: history.undo,
    redo: history.redo,
  });

  const model: { value: string; tone: StatusTone; title?: string } =
    engine.status === "ready"
      ? {
          value: `${engine.engine.manifest.members.length} models`,
          tone: "ok",
        }
      : engine.status === "error"
        ? { value: "Unavailable", tone: "bad", title: engine.error ?? "" }
        : {
            value: `Loading ${Math.round(engine.progress * 100)}%`,
            tone: "busy",
          };
  const solver: { value: string; tone: StatusTone } = health.online
    ? {
        value: health.source === "browser" ? "In browser" : "Online",
        tone: "ok",
      }
    : health.checked
      ? { value: "Offline", tone: "warn" }
      : { value: "Checking", tone: "busy" };

  const verdict = !pred ? null : pred.accepted ? (
    <Badge
      tone="ok"
      title="Inside the training domain and the ensemble agrees within the calibrated threshold"
    >
      Surrogate accepted
    </Badge>
  ) : (
    <Badge tone="warn" title="Run the FEM check to solve this case directly">
      FEM recommended: {REASONS[pred.reason ?? ""] ?? pred.reason}
    </Badge>
  );

  const rail: RailItem[] = [
    {
      id: "templates",
      label: "Templates",
      icon: <LayoutTemplate size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          {PRESETS.map((preset) => (
            <li key={preset.id}>
              <button
                type="button"
                className="px-pick"
                onClick={() => {
                  edit(preset.make());
                  setName(preset.label);
                  close();
                }}
              >
                <LayoutTemplate size={15} aria-hidden="true" />
                {preset.label}
              </button>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "part",
      label: "Part",
      icon: <SlidersHorizontal size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          <li>
            <button
              type="button"
              className="px-pick"
              onClick={() => {
                panels.setInspectorOpen(true);
                close();
              }}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              Edit part and load
              <small>
                {c.family === "plate" ? "Plate" : "L-bracket"} ·{" "}
                {c.geometry.holes.length} holes
              </small>
            </button>
          </li>
        </ul>
      ),
    },
  ];

  return (
    <LabFrame
      study="stress"
      active={active}
      onStudyChange={onStudyChange}
      documentTitle={`${name} · Physix`}
      title={
        <>
          <NameField label="Study name" value={name} onCommit={setName} />
          <UndoRedo
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={history.undo}
            onRedo={history.redo}
          />
        </>
      }
      controls={
        <>
          <button
            type="button"
            className="lab-button lab-button--dark lab-run"
            disabled={!health.online}
            title={
              health.online
                ? "Solve this case with scikit-fem and compare"
                : "The FEM solver is unavailable"
            }
            onClick={startVerify}
          >
            <ShieldCheck size={15} aria-hidden="true" />
            <span>Verify</span>
            <span className="lab-wide-only">&nbsp;with FEM</span>
          </button>
          <button
            type="button"
            className="lab-button lab-secondary"
            onClick={() => setSheet("optimize")}
          >
            <Sparkles size={15} aria-hidden="true" />
            <span>Optimize</span>
          </button>
        </>
      }
      status={
        <>
          <StatusDot label="Model" value={model.value} tone={model.tone} />
          <StatusDot label="Solver" value={solver.value} tone={solver.tone} />
        </>
      }
      menu={[
        {
          label: "Model card",
          icon: <FileBadge size={15} />,
          onSelect: () => setSheet("model"),
        },
        {
          label: "Use from an agent",
          icon: <Bot size={15} />,
          onSelect: () => setSheet("agent"),
        },
        {
          label: "Keyboard shortcuts",
          icon: <Keyboard size={15} />,
          onSelect: () => setSheet("keys"),
        },
        "separator",
        {
          label: "Home",
          icon: <Home size={15} />,
          onSelect: () => {
            window.location.hash = "/";
          },
        },
      ]}
      railLabel="Study tools"
      rail={rail}
      sheets={
        <>
          <Sheet
            open={sheet === "optimize"}
            title="Optimize geometry"
            wide
            onClose={closeSheet}
          >
            <div className="lab-stress">
              <OptimizePanel
                c={c}
                online={health.online}
                browser={health.source === "browser"}
                onApply={(next) => {
                  edit(next);
                  closeSheet();
                  toasts.push({
                    tone: "ok",
                    message:
                      "Applied the selected design. Press Ctrl Z to undo.",
                  });
                }}
              />
            </div>
          </Sheet>
          <Sheet
            open={sheet === "model"}
            title="Model card"
            wide
            onClose={closeSheet}
          >
            <div className="lab-stress lab-model-card">
              <ModelCard health={health} />
            </div>
          </Sheet>
          <Sheet
            open={sheet === "agent"}
            title="Use from an agent"
            wide
            onClose={closeSheet}
          >
            <div className="lab-stress">
              <AgentPanel c={c} />
            </div>
          </Sheet>
          <ShortcutsSheet open={sheet === "keys"} onClose={closeSheet} />
        </>
      }
    >
      <div className="lab-stress lab-field">
        <div className="lab-field-canvas">
          {engine.status === "loading" ? (
            <div className="stage-overlay">
              <Spinner
                label={`Loading the ensemble… ${Math.round(engine.progress * 100)}%`}
              />
            </div>
          ) : null}
          {engine.status === "error" ? (
            <div className="stage-overlay">
              <p className="callout tone-bad">
                The in-browser model could not load: {engine.error} Export a
                bundle with <code>make export</code>; FEM checks still work.
              </p>
            </div>
          ) : null}
          <FieldView
            c={sur.blocked ? c : shownCase}
            values={sur.blocked ? null : values}
            mask={mask}
            range={range}
            colormap={colormapFor(field)}
            editable
            onHolesChange={(holes) =>
              edit({ ...c, geometry: { ...c.geometry, holes } }, "drag")
            }
            formatValue={(v) => mpa(v)}
            markers={
              res && !sur.blocked
                ? [
                    {
                      x: res.hotspot.x,
                      y: res.hotspot.y,
                      label: `peak ${mpa(res.hotspot.von_mises)}`,
                    },
                  ]
                : []
            }
            ariaLabel="Predicted stress field; drag holes to move them, drag the handle to resize"
          />
        </div>
      </div>

      <div className="lab-hud lab-stress">
        <Segmented<FieldKey>
          label="Field"
          value={field}
          onChange={setField}
          options={FIELD_OPTIONS}
        />
        {verdict}
        {pred ? (
          <span
            className="lab-chip num"
            title="Encode, every ONNX member and the ensemble statistics, in this tab"
          >
            {ms(pred.timing.total_ms)} in browser
          </span>
        ) : null}
        {sur.blocked ? (
          <span className="lab-chip" data-tone="warn" role="status">
            Paused: {sur.blocked}
          </span>
        ) : null}
      </div>
      {values && !sur.blocked ? (
        <div className="lab-hud lab-hud-legend lab-stress">
          <Colorbar
            range={range}
            colormap={colormapFor(field)}
            label={FIELD_OPTIONS.find((o) => o.value === field)?.title ?? ""}
            format={(v) => mpa(v)}
          />
        </div>
      ) : null}

      <FloatingPanel
        title="Part"
        anchor="right"
        icon={<SlidersHorizontal size={15} aria-hidden="true" />}
        collapsed={!panels.inspectorOpen}
        onCollapsedChange={(collapsed) => panels.setInspectorOpen(!collapsed)}
        className="lab-inspector lab-inspector-wide"
      >
        <div className="lab-stress">
          <CaseEditor
            c={c}
            invalidField={invalidField}
            onChange={(next) => edit(next, "editor")}
          />
        </div>
      </FloatingPanel>

      <Dock
        title="Results"
        summary={stressSummary({
          peak: res?.hotspot.von_mises,
          safety: sf,
          kt,
          disagreement: res?.disagreement,
          source: pred ? "surrogate" : "no prediction",
        })}
        open={panels.dockOpen}
        onOpenChange={panels.setDockOpen}
        maxFraction={panels.dockMaxFraction}
        defaultHeight={360}
        keepMounted
      >
        <div className="lab-stress">
          <div className="stat-row">
            <Stat
              label="Peak von Mises"
              value={mpa(res?.hotspot.von_mises)}
              sub={
                res
                  ? `at ${mm(res.hotspot.x)}, ${mm(res.hotspot.y)} · grid basis`
                  : "surrogate"
              }
            />
            <Stat
              label="Safety factor"
              value={sf ? sf.toFixed(2) : "—"}
              sub={ys ? `yield ${mpa(ys)}` : "named material needed"}
              tone={
                sf == null
                  ? undefined
                  : sf >= 2
                    ? "ok"
                    : sf >= 1
                      ? "warn"
                      : "bad"
              }
            />
            <Stat
              label="Stress concentration"
              value={kt ? kt.toFixed(2) : "—"}
              sub="peak / applied traction"
            />
            <Stat
              label="Ensemble disagreement"
              value={pct(res?.disagreement)}
              sub={
                threshold != null
                  ? threshold < 0
                    ? "fallback forced for every case"
                    : `threshold ${pct(threshold)}`
                  : "—"
              }
              tone={pred ? (pred.accepted ? "ok" : "warn") : undefined}
            />
          </div>
          {pred && !pred.domain.in_domain ? (
            <div className="callout tone-warn">
              <strong>Outside the training domain.</strong> The surrogate field
              is shown for orientation only; the service answers with FEM.
              <ul>
                {pred.domain.reasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <VerifyPanel
            ref={verify}
            c={c}
            pred={sur.forCase === c ? pred : null}
            online={health.online}
            browser={health.source === "browser"}
            onInvalid={(field) => {
              setInvalidField(field);
              if (field) panels.setInspectorOpen(true);
            }}
          />
        </div>
      </Dock>
    </LabFrame>
  );
}
