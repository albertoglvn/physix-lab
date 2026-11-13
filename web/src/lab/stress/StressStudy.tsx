import {
  Bot,
  ChartScatter,
  FileBadge,
  Grid3x3,
  Home,
  Keyboard,
  LayoutTemplate,
  Link,
  PenLine,
  Ruler,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { api } from "../../api/client";
import { useMemo, useRef, useState } from "react";
import type { Case } from "../../physics/case";
import {
  exampleBracket,
  examplePlate,
  resultantForce,
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
import {
  VerifyPanel,
  type VerifyHandle,
  type VerifyRun,
} from "../../studio/VerifyPanel";
import { Badge, NumField, Segmented, Spinner, Stat } from "../../ui/controls";
import { Colorbar, FieldView } from "../../ui/FieldView";
import { mm, mpa, ms, newtons, pct } from "../../ui/units";
import {
  LabFrame,
  NameField,
  ShortcutsSheet,
  StatusDot,
  UndoRedo,
  useLabPanels,
  type StatusTone,
} from "../LabFrame";
import { caseShareUrl } from "../shared";
import { useShortcuts } from "../shortcuts";
import { useHistory } from "../state/history";
import { Dock } from "../ui/Dock";
import { FloatingPanel } from "../ui/FloatingPanel";
import type { RailItem } from "../ui/Rail";
import { Sheet } from "../ui/Sheet";
import { toasts } from "../ui/toastStore";
import { safetyFactor } from "./compare";
import { HOTSPOT_RULE, ktReferences, measuredKt } from "./concentration";
import { convergenceCsv, studyProbes } from "./convergence";
import {
  ConvergenceSheet,
  referencePreset,
  useConvergence,
} from "./ConvergenceSheet";
import { stressSweepCsv, type StressSweepDeps } from "./stressSweep";
import { StressSweepSheet, useStressSweep } from "./StressSweepSheet";
import { defaultLines, type ProbeLine } from "./probe";
import { signedPct, StressProbe } from "./StressProbe";
import { stressSummary } from "./summary";
import "./stress.css";

const REASONS: Record<string, string> = {
  out_of_domain: "outside the training domain",
  high_disagreement: "the ensemble members disagree",
  non_finite_prediction: "non-finite prediction",
};

type StressSheet = LabSheet | "keys" | "sweep" | "convergence" | null;

type DockView = "summary" | "probe" | "fem";

/** A preset line follows the part as it changes; a drawn line stays where it was drawn. */
type ProbeChoice = { preset: string } | { custom: ProbeLine };

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "study";

function download(name: string, text: string, type: string) {
  const href = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export type StressStudyProps = {
  active: boolean;
  example?: StressExample;
  sheet?: LabSheet;
  /** A validated case from a share link; it replaces the example. */
  initialCase?: Case;
  onStudyChange: (study: Study) => void;
};

/** Plane-stress analysis of plates and brackets: the former stress studio as one study. */
export function StressStudy({
  active,
  example = "plate",
  sheet: initialSheet,
  initialCase,
  onStudyChange,
}: StressStudyProps) {
  const history = useHistory<Case>(
    () =>
      initialCase ??
      (example === "bracket" ? exampleBracket() : examplePlate()),
  );
  const c = history.value;
  const [name, setName] = useState(() => {
    const family = initialCase?.family ?? example;
    const label = family === "bracket" ? "L-bracket study" : "Plate study";
    return initialCase ? `Shared ${label.toLowerCase()}` : label;
  });
  const [field, setField] = useState<FieldKey>("von_mises");
  const [invalidField, setInvalidField] = useState<string | null>(null);
  const [sheet, setSheet] = useState<StressSheet>(initialSheet ?? null);
  const [dockView, setDockView] = useState<DockView>("summary");
  const [probe, setProbe] = useState<ProbeChoice>({ preset: "" });
  const [drawing, setDrawing] = useState(false);
  const [yieldOverride, setYieldOverride] = useState<number | null>(null);
  const [femRun, setFemRun] = useState<VerifyRun | null>(null);
  const panels = useLabPanels();
  const verify = useRef<VerifyHandle>(null);
  const health = useHealth();
  const engine = useEngine();
  const sweep = useStressSweep();
  const convergence = useConvergence();
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
  const materialYield = yieldStrength(c);
  const ys = yieldOverride ?? materialYield;
  const sf = safetyFactor(ys, res?.hotspot.von_mises);
  const kt = res ? (measuredKt(c, res.hotspot.von_mises)?.gross ?? null) : null;
  const ktRef = useMemo(() => ktReferences(c), [c]);
  const threshold = engine.engine?.policy.threshold ?? null;

  const presets = useMemo(() => defaultLines(c), [c]);
  const preset =
    "preset" in probe
      ? (presets.find((p) => p.id === probe.preset) ?? presets[0])
      : null;
  const line = "custom" in probe ? probe.custom : preset!.line;
  const fem = femRun?.forCase === JSON.stringify(c) ? femRun.data : null;
  const studyPoints = useMemo(() => studyProbes(c, line), [c, line]);
  const meshPreset = referencePreset(convergence.run, c);
  const loaded = engine.engine;
  const sweepDeps: StressSweepDeps = useMemo(
    () => ({
      predict: loaded ? (next) => loaded.predict(next) : null,
      solve: health.online
        ? (next) => api.predict(next, { force_fem: true })
        : null,
    }),
    [loaded, health.online],
  );
  const showLine = drawing || (panels.dockOpen && dockView === "probe");

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
    setDockView("fem");
    verify.current?.start();
  };

  const openProbe = (next?: ProbeChoice) => {
    if (next) setProbe(next);
    setDockView("probe");
    panels.setDockOpen(true);
  };

  const startDrawing = (on: boolean) => {
    setDrawing(on);
    if (on) openProbe();
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
          {PRESETS.map((template) => (
            <li key={template.id}>
              <button
                type="button"
                className="px-pick"
                onClick={() => {
                  edit(template.make());
                  setName(template.label);
                  setProbe({ preset: "" });
                  close();
                }}
              >
                <LayoutTemplate size={15} aria-hidden="true" />
                {template.label}
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
    {
      id: "studies",
      label: "Studies",
      icon: <ChartScatter size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          <li>
            <button
              type="button"
              className="px-pick"
              onClick={() => {
                setSheet("sweep");
                close();
              }}
            >
              <ChartScatter size={15} aria-hidden="true" />
              Parameter sweep
              <small>surrogate screen, FEM where needed</small>
            </button>
          </li>
          <li>
            <button
              type="button"
              className="px-pick"
              onClick={() => {
                setSheet("convergence");
                close();
              }}
            >
              <Grid3x3 size={15} aria-hidden="true" />
              Mesh convergence
              <small>
                {meshPreset
                  ? `reference mesh: ${meshPreset}`
                  : "three meshes, Richardson and GCI"}
              </small>
            </button>
          </li>
        </ul>
      ),
    },
    {
      id: "probe",
      label: "Line probe",
      icon: <Ruler size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          {presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                className="px-pick"
                onClick={() => {
                  setDrawing(false);
                  openProbe({ preset: p.id });
                  close();
                }}
              >
                <Ruler size={15} aria-hidden="true" />
                {p.label}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="px-pick"
              onClick={() => {
                startDrawing(true);
                close();
              }}
            >
              <PenLine size={15} aria-hidden="true" />
              Draw a line
              <small>press and drag over the part</small>
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
          label: "Copy share link",
          icon: <Link size={15} />,
          onSelect: () => {
            void caseShareUrl(c)
              .then((url) => navigator.clipboard.writeText(url))
              .then(
                () =>
                  toasts.push({
                    tone: "ok",
                    message:
                      "Share link copied. It opens this part; results are recomputed.",
                  }),
                (error: unknown) =>
                  toasts.push({
                    tone: "bad",
                    message:
                      error instanceof Error ? error.message : String(error),
                  }),
              );
          },
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
          <Sheet
            open={sheet === "sweep"}
            title="Stress sweep"
            wide
            onClose={closeSheet}
          >
            <div className="lab-stress">
              <StressSweepSheet
                c={c}
                state={sweep}
                deps={sweepDeps}
                modelReady={engine.status === "ready"}
                online={health.online}
                onExport={(run) =>
                  download(
                    `${slug(name)}-stress-sweep.csv`,
                    stressSweepCsv(run.base, run.spec, run.points, {
                      modelId: engine.engine?.manifest.model_id ?? null,
                      threshold,
                    }),
                    "text/csv",
                  )
                }
              />
            </div>
          </Sheet>
          <Sheet
            open={sheet === "convergence"}
            title="Mesh convergence"
            wide
            onClose={closeSheet}
          >
            <div className="lab-stress">
              <ConvergenceSheet
                c={c}
                state={convergence}
                probes={studyPoints}
                probeLabel={
                  preset ? `${preset.label.toLowerCase()} probe` : "drawn line"
                }
                online={health.online}
                onExport={(study) =>
                  download(
                    `${slug(name)}-convergence.csv`,
                    convergenceCsv(study),
                    "text/csv",
                  )
                }
              />
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
            line={showLine ? line : null}
            onLineChange={(next) => setProbe({ custom: next })}
            drawing={drawing}
            onDrawEnd={() => {
              setDrawing(false);
              openProbe();
            }}
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
            ariaLabel={
              drawing
                ? "Predicted stress field; press and drag to draw a probe line"
                : "Predicted stress field; drag holes to move them, drag the handle to resize"
            }
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
        {drawing ? (
          <button
            type="button"
            className="lab-chip lab-chip-button"
            onClick={() => setDrawing(false)}
            title="Stop drawing"
          >
            Drag over the part to draw a line · Cancel
          </button>
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
        <div className="lab-stress lab-stress-dock">
          <Segmented<DockView>
            label="Results view"
            value={dockView}
            onChange={setDockView}
            options={[
              { value: "summary", label: "Summary" },
              { value: "probe", label: "Line probe" },
              { value: "fem", label: "FEM check" },
            ]}
          />
          <div hidden={dockView !== "summary"}>
            <div className="stat-row">
              <Stat
                label="Peak von Mises"
                value={mpa(res?.hotspot.von_mises)}
                sub={
                  res
                    ? `at ${mm(res.hotspot.x)}, ${mm(res.hotspot.y)} · grid basis`
                    : "surrogate"
                }
                title={HOTSPOT_RULE}
              />
              <Stat
                label="Safety factor"
                value={sf ? sf.toFixed(2) : "—"}
                sub={
                  ys
                    ? `yield ${mpa(ys)}${yieldOverride != null ? " (entered)" : ""}`
                    : "enter a yield strength"
                }
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
                sub={
                  ktRef.applicable
                    ? `Heywood ${ktRef.heywoodGross.toFixed(2)}${
                        kt
                          ? ` · ${signedPct((kt - ktRef.heywoodGross) / ktRef.heywoodGross)}`
                          : ""
                      }`
                    : "peak / applied traction"
                }
                title={`Gross-section Kt: peak von Mises over the applied traction. ${HOTSPOT_RULE}${
                  ktRef.applicable
                    ? ` Kirsch (infinite plate) ${ktRef.kirsch}; Heywood at d/H ${ktRef.dOverH.toFixed(2)}: net ${ktRef.heywoodNet.toFixed(3)}, gross ${ktRef.heywoodGross.toFixed(3)}.`
                    : ` No closed-form reference: ${ktRef.reason}.`
                }`}
              />
              <Stat
                label="Ensemble disagreement"
                value={pct(res?.disagreement)}
                sub={
                  threshold != null
                    ? threshold < 0
                      ? "fallback forced for every case"
                      : `model spread · threshold ${pct(threshold)}`
                    : "model spread"
                }
                title="Spread between the five models, not an error against the solver"
                tone={pred ? (pred.accepted ? "ok" : "warn") : undefined}
              />
            </div>
            <div className="lab-stress-inputs">
              <NumField
                label="Yield strength"
                value={ys ?? 0}
                scale={1e-6}
                unit="MPa"
                min={0}
                step={10}
                hint={
                  materialYield
                    ? `From the material: ${mpa(materialYield)}. Edit to use your own value.`
                    : "This material has no tabulated yield strength; enter one."
                }
                onChange={(value) =>
                  setYieldOverride(
                    value > 0 && value !== materialYield ? value : null,
                  )
                }
              />
              {yieldOverride != null && materialYield ? (
                <button
                  type="button"
                  className="lab-button"
                  onClick={() => setYieldOverride(null)}
                >
                  Use material value
                </button>
              ) : null}
              {fem ? (
                <p className="lab-check">
                  <span>Equilibrium</span>
                  <span className="num">
                    applied {newtons(Math.hypot(...resultantForce(c)))} ·
                    reaction{" "}
                    {fem.summary.reaction_force
                      ? newtons(Math.hypot(...fem.summary.reaction_force))
                      : "—"}{" "}
                    · residual{" "}
                    {fem.summary.equilibrium_residual != null
                      ? fem.summary.equilibrium_residual.toExponential(1)
                      : "—"}
                  </span>
                </p>
              ) : (
                <p className="lab-check">
                  <span>Reactions and equilibrium come from the solver.</span>
                  <button
                    type="button"
                    className="lab-button"
                    disabled={!health.online}
                    onClick={startVerify}
                  >
                    <ShieldCheck size={15} aria-hidden="true" />
                    <span>Run FEM check</span>
                  </button>
                </p>
              )}
            </div>
            {pred && !pred.domain.in_domain ? (
              <div className="callout tone-warn">
                <strong>Outside the training domain.</strong> The surrogate
                field is shown for orientation only; the service answers with
                FEM.
                <ul>
                  {pred.domain.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
          <div hidden={dockView !== "probe"}>
            <StressProbe
              c={shownCase}
              pred={sur.blocked ? null : pred}
              modelId={engine.engine?.manifest.model_id ?? null}
              mask={mask}
              field={field}
              line={line}
              presets={presets}
              preset={preset?.id ?? null}
              onPreset={(id) => {
                if (id !== "custom") setProbe({ preset: id });
              }}
              drawing={drawing}
              onDrawingChange={startDrawing}
              fem={sur.forCase === c ? fem : null}
              canSolve={health.online}
              onSolve={startVerify}
              onExport={(csv) =>
                download(`${slug(name)}-probe.csv`, csv, "text/csv")
              }
            />
          </div>
          <div hidden={dockView !== "fem"}>
            <VerifyPanel
              ref={verify}
              c={c}
              pred={sur.forCase === c ? pred : null}
              online={health.online}
              browser={health.source === "browser"}
              meshPreset={meshPreset}
              onResult={setFemRun}
              onInvalid={(field) => {
                setInvalidField(field);
                if (field) panels.setInspectorOpen(true);
              }}
            />
          </div>
        </div>
      </Dock>
    </LabFrame>
  );
}
