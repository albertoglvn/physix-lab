import {
  Box,
  ChartScatter,
  Circle,
  CircleDot,
  Code2,
  Copy,
  Download,
  Focus,
  GitCommitVertical,
  Home,
  Info,
  Keyboard,
  LayoutTemplate,
  ListTree,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  SlidersHorizontal,
  Trash2,
  TriangleRight,
  Upload,
  WavesVertical,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { labHash, replaceHash, type Study } from "../../routes";
import {
  LabFrame,
  NameField,
  ShortcutsSheet,
  StatusDot,
  UndoRedo,
  useLabPanels,
  type StatusTone,
} from "../LabFrame";
import { LabViewport } from "../LabViewport";
import {
  findRampPlacement,
  isBody,
  limits,
  makeObject,
  makeScene,
  OBJECT_LIMIT,
  objectNames,
  parseScene,
  presetNames,
  replaceObject,
  type LabObject,
  type LabScene,
  type Preset,
  type Ramp,
} from "../scene";
import { createSimulation, TIME_STEP, type Simulation } from "../simulation";
import { useShortcuts } from "../shortcuts";
import { useHistory } from "../state/history";
import { Dock } from "../ui/Dock";
import { FloatingPanel } from "../ui/FloatingPanel";
import type { RailItem } from "../ui/Rail";
import { Sheet } from "../ui/Sheet";
import { toasts } from "../ui/toastStore";
import { UnitInput } from "../ui/UnitInput";
import { runToCsv } from "../data/exportCsv";
import { formatDelta, methodsSummary } from "../data/methods";
import {
  experimentJson,
  isExperiment,
  makeExperiment,
  parseExperiment,
  type Experiment,
} from "../state/experiment";
import { checkConvergence } from "./convergence";
import { measure, summarize } from "./measurements";
import {
  MotionData,
  probeTarget,
  revealTime,
  seriesColour,
  type DataView,
  type StepCheck,
} from "./MotionData";
import {
  availableStops,
  EVENT_LABELS,
  MAX_TIME_LIMITS,
  protocolFor,
  SYSTEM,
  type Protocol,
} from "./probes";
import { reproduce, runProtocol, type MotionRun } from "./run";
import { metricTarget } from "./sweep";
import { SweepData } from "./SweepData";
import { SweepSheet } from "./SweepSheet";
import { compare, curvesFor, referencesFor, type Reference } from "./theory";
import { sweepMethods, sweepToCsv, storedFit } from "./sweepExport";
import { fitSweep, type SweepFit } from "./sweepFit";
import { useSweep } from "./useSweep";

const icons = {
  block: Box,
  ball: Circle,
  ramp: TriangleRight,
  pulley: CircleDot,
  pendulum: GitCommitVertical,
  spring: WavesVertical,
};
const objectKinds = [
  "block",
  "ball",
  "ramp",
  "pulley",
  "pendulum",
  "spring",
] as const;
/** The part selected when a scene opens: the first moving part, else the first part. */
const firstPart = (scene: LabScene) =>
  (scene.objects.find((part) => part.kind !== "ramp") ?? scene.objects[0])
    ?.id ?? null;

const TEMPLATE_NOTES: Record<Preset, string> = {
  incline: "Block sliding down a rough ramp",
  friction: "Block sliding to rest on the floor",
  projectile: "Horizontal launch from a height",
  pulley: "Ideal Atwood machine",
  rolling: "Solid ball rolling down a ramp",
  pendulum: "Rigid pendulum released from rest",
  spring: "Mass on a vertical spring",
  blank: "Empty floor",
};

type Runtime = {
  scene: LabScene;
  revision: number;
} & (
  | { simulation: Simulation; error?: never }
  | { simulation?: never; error: string }
);

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const DEG = Math.PI / 180;
/** Degrees stored in the scene, shown through an angle field that works in radians. */
const toDegrees = (radians: number) => Number((radians / DEG).toFixed(9));
const range = (limit: readonly [number, number, number], scale = 1) => ({
  min: limit[0] * scale,
  max: limit[1] * scale,
});

/** Largest file the JSON sheet loads: experiment files carry every probe sample. */
const FILE_LIMIT = 16_000_000;
const PAST_STOPS: Record<Protocol["stop"], string> = {
  rest: "came to rest",
  leaves_ramp: "left the ramp",
  floor_contact: "touched the floor",
  pulley_stop: "reached its stop",
  time: "reached the time limit",
};

const slug = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "experiment";

function download(name: string, text: string, type: string) {
  const href = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(href), 1000);
}

function downloadScene(scene: LabScene) {
  download(
    `${slug(scene.name)}.physix.json`,
    JSON.stringify(scene, null, 2) + "\n",
    "application/json",
  );
}

type RunRecord = {
  scene: LabScene;
  protocol: Protocol;
  run?: MotionRun;
  error?: string;
};

function ObjectFields({
  object,
  onChange,
}: {
  object: LabObject;
  onChange: (object: LabObject) => void;
}) {
  const position = (
    <>
      <UnitInput
        label="X"
        dimension="length"
        unit="m"
        value={object.x}
        {...range(limits.position)}
        onCommit={(x) => onChange({ ...object, x })}
      />
      <UnitInput
        label="Z"
        dimension="length"
        unit="m"
        value={object.z}
        {...range(limits.position)}
        onCommit={(z) => onChange({ ...object, z })}
      />
    </>
  );
  if (object.kind === "block")
    return (
      <div className="lab-fields">
        {position}
        <UnitInput
          label="Height"
          dimension="length"
          unit="m"
          value={object.y}
          {...range(limits.height)}
          onCommit={(y) => onChange({ ...object, y })}
        />
        <UnitInput
          label="Size"
          dimension="length"
          unit="m"
          value={object.size}
          {...range(limits.size)}
          onCommit={(size) => onChange({ ...object, size })}
        />
        <UnitInput
          label="Mass"
          dimension="mass"
          unit="kg"
          value={object.mass}
          {...range(limits.mass)}
          onCommit={(mass) => onChange({ ...object, mass })}
        />
        <UnitInput
          label="Tilt"
          dimension="angle"
          unit="deg"
          value={object.rotation * DEG}
          {...range(limits.rotation, DEG)}
          onCommit={(rotation) =>
            onChange({ ...object, rotation: toDegrees(rotation) })
          }
        />
        <UnitInput
          label="Initial X speed"
          dimension="velocity"
          unit="m/s"
          value={object.vx}
          {...range(limits.velocity)}
          onCommit={(vx) => onChange({ ...object, vx })}
        />
      </div>
    );
  if (object.kind === "ball")
    return (
      <div className="lab-fields">
        {position}
        <UnitInput
          label="Height"
          dimension="length"
          unit="m"
          value={object.y}
          {...range(limits.height)}
          onCommit={(y) => onChange({ ...object, y })}
        />
        <UnitInput
          label="Radius"
          dimension="length"
          unit="m"
          value={object.radius}
          {...range(limits.radius)}
          onCommit={(radius) => onChange({ ...object, radius })}
        />
        <UnitInput
          label="Mass"
          dimension="mass"
          unit="kg"
          value={object.mass}
          {...range(limits.mass)}
          onCommit={(mass) => onChange({ ...object, mass })}
        />
        <UnitInput
          label="Initial X speed"
          dimension="velocity"
          unit="m/s"
          value={object.vx}
          {...range(limits.velocity)}
          onCommit={(vx) => onChange({ ...object, vx })}
        />
      </div>
    );
  if (object.kind === "pendulum")
    return (
      <div className="lab-fields">
        {position}
        <UnitInput
          label="Pivot height"
          dimension="length"
          unit="m"
          value={object.pivotHeight}
          {...range(limits.pivotHeight)}
          onCommit={(pivotHeight) => onChange({ ...object, pivotHeight })}
        />
        <UnitInput
          label="Length"
          dimension="length"
          unit="m"
          value={object.length}
          {...range(limits.pendulumLength)}
          onCommit={(length) => onChange({ ...object, length })}
        />
        <UnitInput
          label="Release angle"
          dimension="angle"
          unit="deg"
          value={object.angle * DEG}
          {...range(limits.swing, DEG)}
          onCommit={(angle) => onChange({ ...object, angle: toDegrees(angle) })}
        />
        <UnitInput
          label="Bob mass"
          dimension="mass"
          unit="kg"
          value={object.mass}
          {...range(limits.mass)}
          onCommit={(mass) => onChange({ ...object, mass })}
        />
        <UnitInput
          label="Bob radius"
          dimension="length"
          unit="m"
          value={object.bobRadius}
          {...range(limits.bobRadius)}
          onCommit={(bobRadius) => onChange({ ...object, bobRadius })}
        />
      </div>
    );
  if (object.kind === "spring")
    return (
      <div className="lab-fields">
        {position}
        <UnitInput
          label="Anchor height"
          dimension="length"
          unit="m"
          value={object.anchorHeight}
          {...range(limits.pivotHeight)}
          onCommit={(anchorHeight) => onChange({ ...object, anchorHeight })}
        />
        <UnitInput
          label="Stiffness k"
          dimension="stiffness"
          unit="N/m"
          value={object.stiffness}
          {...range(limits.stiffness)}
          onCommit={(stiffness) => onChange({ ...object, stiffness })}
        />
        <UnitInput
          label="Damping c"
          dimension="damping"
          unit="N·s/m"
          value={object.damping}
          {...range(limits.damping)}
          onCommit={(damping) => onChange({ ...object, damping })}
        />
        <UnitInput
          label="Rest length"
          dimension="length"
          unit="m"
          value={object.restLength}
          {...range(limits.restLength)}
          onCommit={(restLength) => onChange({ ...object, restLength })}
        />
        <UnitInput
          label="Mass"
          dimension="mass"
          unit="kg"
          value={object.mass}
          {...range(limits.mass)}
          onCommit={(mass) => onChange({ ...object, mass })}
        />
        <UnitInput
          label="Cube size"
          dimension="length"
          unit="m"
          value={object.size}
          {...range(limits.size)}
          onCommit={(size) => onChange({ ...object, size })}
        />
        <UnitInput
          label="Release offset"
          dimension="length"
          unit="m"
          value={object.offset}
          {...range(limits.offset)}
          onCommit={(offset) => onChange({ ...object, offset })}
        />
      </div>
    );
  if (object.kind === "ramp")
    return (
      <div className="lab-fields">
        {position}
        <UnitInput
          label="Length"
          dimension="length"
          unit="m"
          value={object.length}
          {...range(limits.length)}
          onCommit={(length) => onChange({ ...object, length })}
        />
        <UnitInput
          label="Width"
          dimension="length"
          unit="m"
          value={object.width}
          {...range(limits.width)}
          onCommit={(width) => onChange({ ...object, width })}
        />
        <UnitInput
          label="Angle"
          dimension="angle"
          unit="deg"
          value={object.angle * DEG}
          {...range(limits.angle, DEG)}
          onCommit={(angle) => onChange({ ...object, angle: toDegrees(angle) })}
        />
        <UnitInput
          label="Friction μ"
          dimension="ratio"
          unit=""
          value={object.friction}
          {...range(limits.friction)}
          onCommit={(friction) => onChange({ ...object, friction })}
        />
      </div>
    );
  return (
    <div className="lab-fields">
      {position}
      <UnitInput
        label="Left mass"
        dimension="mass"
        unit="kg"
        value={object.leftMass}
        {...range(limits.mass)}
        onCommit={(leftMass) => onChange({ ...object, leftMass })}
      />
      <UnitInput
        label="Right mass"
        dimension="mass"
        unit="kg"
        value={object.rightMass}
        {...range(limits.mass)}
        onCommit={(rightMass) => onChange({ ...object, rightMass })}
      />
    </div>
  );
}

export type MotionStudyProps = {
  active: boolean;
  template?: Preset;
  onStudyChange: (study: Study) => void;
};

/** Rigid-body motion: the former mechanics lab inside the shared shell. */
export function MotionStudy({
  active,
  template = "incline",
  onStudyChange,
}: MotionStudyProps) {
  const history = useHistory(() => makeScene(template));
  const scene = history.value;
  const [selected, setSelected] = useState<string | null>(() =>
    firstPart(scene),
  );
  const [revision, setRevision] = useState(0);
  const [viewRevision, setViewRevision] = useState(0);
  const [runtime, setRuntime] = useState<Runtime>();
  const [running, setRunning] = useState(false);
  const [clock, setClock] = useState<{
    simulation: Simulation;
    time: number;
  }>();
  const [sheet, setSheet] = useState<
    "json" | "keys" | "export" | "sweep" | null
  >(null);
  const [view, setView] = useState<DataView>("plot");
  const sweep = useSweep();
  const sweepRecord = sweep.state?.record;
  const sweepFit = sweep.state?.fit ? storedFit(sweep.state.fit) : undefined;
  const [json, setJson] = useState("");
  const [jsonError, setJsonError] = useState("");
  const jsonFile = useRef<HTMLInputElement>(null);
  const panels = useLabPanels();
  const [protocolChoice, setProtocolChoice] = useState<Protocol | null>(null);
  const [record, setRecord] = useState<RunRecord>();
  const [check, setCheck] = useState<StepCheck & { runId: string }>();

  const current =
    runtime?.scene === scene && runtime.revision === revision
      ? runtime
      : undefined;
  const simulation = current?.simulation;
  const object = scene.objects.find((part) => part.id === selected);
  const time = clock && clock.simulation === simulation ? clock.time : 0;
  const select = useCallback((id: string | null) => setSelected(id), []);
  const protocol = useMemo(
    () => protocolFor(scene, protocolChoice),
    [scene, protocolChoice],
  );
  const result =
    record?.scene === scene && record.protocol === protocol
      ? record
      : undefined;
  const recorded = result?.run;
  const stopTick = recorded
    ? Math.round(recorded.stop.t / TIME_STEP)
    : undefined;
  const stopped =
    stopTick !== undefined && Math.round(time / TIME_STEP) >= stopTick;
  const stopMessage = recorded
    ? `${recorded.stop.event?.target ?? "The run"} ${PAST_STOPS[recorded.stop.event?.type ?? "time"]} at t = ${recorded.stop.t.toFixed(3)} s.`
    : "";
  const references = useMemo(() => referencesFor(scene), [scene]);
  const curves = useMemo(() => curvesFor(scene), [scene]);
  const target = probeTarget(scene, selected);
  const comparisons = references
    .filter((reference) => target === SYSTEM || reference.target === target)
    .map((reference) => compare(reference, recorded));
  const stepCheck = check && check.runId === recorded?.id ? check : undefined;

  useEffect(() => {
    let cancelled = false;
    runProtocol(scene, protocol).then(
      (run) => {
        if (!cancelled) setRecord({ scene, protocol, run });
      },
      (error: unknown) => {
        if (!cancelled) setRecord({ scene, protocol, error: message(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scene, protocol]);

  useEffect(() => {
    let cancelled = false;
    let created: Simulation | undefined;
    createSimulation(scene)
      .then((next) => {
        if (cancelled) next.dispose();
        else {
          created = next;
          setRuntime({ scene, revision, simulation: next });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setRuntime({ scene, revision, error: message(error) });
        toasts.push({
          tone: "bad",
          message: `The simulation could not start. ${message(error)}`,
        });
      });
    return () => {
      cancelled = true;
      created?.dispose();
    };
  }, [scene, revision]);

  useEffect(() => {
    if (!running || !simulation || !active) return;
    let frame = 0;
    let previous = performance.now();
    let remainder = 0;
    let reported = simulation.time;
    const ticks = () => Math.round(simulation.time / TIME_STEP);
    const tick = (now: number) => {
      remainder += Math.max(0, Math.min((now - previous) / 1000, 0.1));
      previous = now;
      let steps = Math.floor(remainder / TIME_STEP);
      // The live run pauses on the protocol's stop, the same step the headless run ended.
      if (stopTick !== undefined) steps = Math.min(steps, stopTick - ticks());
      if (steps > 0) {
        simulation.step(steps);
        remainder -= steps * TIME_STEP;
        if (simulation.time - reported >= 0.075) {
          reported = simulation.time;
          setClock({ simulation, time: reported });
        }
      }
      if (stopTick !== undefined && ticks() >= stopTick) {
        setClock({ simulation, time: simulation.time });
        setRunning(false);
        toasts.push({ tone: "info", message: `Stopped: ${stopMessage}` });
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [running, simulation, active, stopTick, stopMessage]);

  /** Validates and commits an edit as one undo step. Returns false when it was rejected. */
  function apply(next: LabScene, nextSelected = selected): boolean {
    try {
      const validated = parseScene(next);
      setRunning(false);
      history.set(validated);
      setSelected(nextSelected);
      return true;
    } catch (error) {
      toasts.push({ tone: "bad", message: message(error) });
      return false;
    }
  }

  function loadTemplate(next: Preset) {
    const initial = makeScene(next);
    if (apply(initial, firstPart(initial))) {
      setViewRevision((value) => value + 1);
      replaceHash(labHash({ study: "motion", template: next }));
    }
  }

  function updateObject(next: LabObject) {
    apply(replaceObject(scene, next));
  }

  function placeOnRamp(ramp: Ramp) {
    if (!object || !isBody(object)) return;
    const placed = findRampPlacement(object, ramp, scene.objects);
    if (placed) updateObject(placed);
    else
      toasts.push({
        tone: "warn",
        message: `${ramp.id} has no free starting position for ${object.id}.`,
      });
  }

  function insert(kind: LabObject["kind"]) {
    let serial = 1;
    while (scene.objects.some((part) => part.id === `${kind}-${serial}`))
      serial++;
    const count = scene.objects.length;
    const x = count === 0 ? 0 : (((count - 1) % 5) - 2) * 2.6;
    const z = count === 0 ? 0 : 3 + Math.floor((count - 1) / 5) * 2.2;
    const part = makeObject(kind, `${kind}-${serial}`, x, z);
    if (apply({ ...scene, objects: [...scene.objects, part] }, part.id))
      panels.setInspectorOpen(true);
  }

  function remove() {
    if (!object) return;
    const objects = scene.objects.filter((part) => part.id !== object.id);
    if (apply({ ...scene, objects }, null))
      toasts.push({
        tone: "info",
        message: `Removed ${object.id}. Press Ctrl Z to undo.`,
      });
  }

  function undo() {
    setRunning(false);
    history.undo();
  }

  function redo() {
    setRunning(false);
    history.redo();
  }

  function reset() {
    setRunning(false);
    setRevision((value) => value + 1);
  }

  function run() {
    if (!simulation) return;
    if (stopped && !running) {
      // Replay: a fresh simulation from the starting state, running as soon as it loads.
      setRevision((value) => value + 1);
      setRunning(true);
      return;
    }
    if (running) setClock({ simulation, time: simulation.time });
    setRunning(!running);
  }

  function advance() {
    if (!simulation || running || stopped) return;
    simulation.step();
    setClock({ simulation, time: simulation.time });
  }

  function setProtocol(next: Protocol) {
    setProtocolChoice(next);
    reset();
  }

  function runCheck(reference: Reference) {
    if (!recorded) return;
    const runId = recorded.id;
    setCheck({ runId, reference });
    checkConvergence(scene, protocol, reference).then(
      (result) =>
        setCheck((previous) =>
          previous?.runId === runId && previous.reference === reference
            ? { ...previous, result }
            : previous,
        ),
      (error: unknown) =>
        setCheck((previous) =>
          previous?.runId === runId && previous.reference === reference
            ? { ...previous, error: message(error) }
            : previous,
        ),
    );
  }

  async function exportExperiment() {
    if (!recorded) return;
    const experiment = await makeExperiment(
      scene,
      protocol,
      [recorded],
      sweepRecord ? { record: sweepRecord, fit: sweepFit } : undefined,
    );
    download(
      `${slug(scene.name)}.experiment.json`,
      experimentJson(experiment),
      "application/json",
    );
  }

  function importExperiment(experiment: Experiment) {
    const next = experiment.studies.motion.scene;
    if (!apply(next, firstPart(next))) return;
    setProtocolChoice(experiment.protocol);
    setSheet(null);
    setViewRevision((value) => value + 1);
    if (experiment.sweep) restoreSweep(experiment.sweep);
    const [stored] = experiment.runs;
    if (!stored) return;
    reproduce(stored).then(
      (outcome) =>
        toasts.push(
          outcome.identical
            ? { tone: "ok", message: "The stored run reproduced exactly." }
            : {
                tone: "warn",
                message: `The re-run differs from the stored run by up to ${outcome.largestDifference.toPrecision(3)}${
                  outcome.sameEngine
                    ? "."
                    : `; it was recorded with Rapier ${stored.engine.version}, this lab uses ${outcome.run.engine.version}.`
                }`,
              },
        ),
      (error: unknown) =>
        toasts.push({
          tone: "bad",
          message: `The stored run could not be repeated. ${message(error)}`,
        }),
    );
  }

  function restoreSweep({ record, fit }: NonNullable<Experiment["sweep"]>) {
    let refit: SweepFit | undefined;
    if (fit)
      try {
        refit = fitSweep(
          record.scene,
          record.spec,
          record.points,
          fit.model,
          fit.expression,
        );
      } catch (error) {
        toasts.push({
          tone: "warn",
          message: `The stored fit could not be repeated. ${message(error)}`,
        });
      }
    sweep.load(record, refit);
    setView("sweep");
    panels.setDockOpen(true);
  }

  function openJson() {
    setJson(JSON.stringify(scene, null, 2));
    setJsonError("");
    setSheet("json");
  }

  function importJson() {
    try {
      const parsed = JSON.parse(json) as unknown;
      if (isExperiment(parsed)) {
        importExperiment(parseExperiment(parsed));
        return;
      }
      const next = parseScene(parsed);
      if (apply(next, next.objects[0]?.id ?? null)) {
        setSheet(null);
        setViewRevision((value) => value + 1);
      }
    } catch (error) {
      setJsonError(message(error));
    }
  }

  useShortcuts(active && sheet === null, {
    run,
    step: advance,
    reset,
    frame: () => setViewRevision((value) => value + 1),
    delete: remove,
    deselect: () => setSelected(null),
    undo,
    redo,
  });

  const engine: { value: string; tone: StatusTone } = current?.error
    ? { value: "Unavailable", tone: "bad" }
    : !simulation
      ? { value: "Loading", tone: "busy" }
      : running
        ? { value: "Running", tone: "ok" }
        : { value: time > 0 ? "Paused" : "Ready", tone: "idle" };
  const readings = measure(scene, object, simulation, time);
  const ramps = scene.objects.filter((part) => part.kind === "ramp");
  const full = scene.objects.length >= OBJECT_LIMIT;
  const stops = availableStops(scene);
  const firstResult = recorded
    ? comparisons.find(
        (comparison) =>
          comparison.delta !== undefined &&
          !comparison.reference.broken &&
          time + 1e-9 >= revealTime(comparison.reference, recorded),
      )
    : undefined;
  const summary = [
    summarize(readings),
    firstResult
      ? `Δ ${firstResult.reference.symbol} ${formatDelta(firstResult)}`
      : "",
  ]
    .filter(Boolean)
    .join(" · ");
  const methods =
    sheet === "export" && recorded
      ? [
          methodsSummary(
            recorded,
            references.map((reference) => compare(reference, recorded)),
            stepCheck?.result,
          ),
          sweepRecord ? sweepMethods(sweepRecord, sweepFit) : "",
        ]
          .filter(Boolean)
          .join("\n\n")
      : "";
  const help =
    object?.kind === "pulley"
      ? "Ideal Atwood machine with a massless rope and wheel. Motion ends when a weight reaches its stop. Positive acceleration lowers the right mass. Edits set the starting state and reset the run. Metres, Y up."
      : object?.kind === "pendulum"
        ? "Rigid, massless rod on a frictionless hinge. The release angle is measured from straight down, positive anticlockwise seen from +Z. Edits reset the run. Metres, Y up."
        : object?.kind === "spring"
          ? "Linear spring and viscous damper; the cube moves along Y only. The release offset is measured from the hanging equilibrium, positive up. Edits reset the run. Metres, Y up."
          : object
            ? "Edits set the starting state and reset the run. Metres, Y up."
            : "Gravity and floor friction apply to every part. The protocol sets when a run stops; the live run pauses there. Edits reset the run. Metres, Y up.";

  const rail: RailItem[] = [
    {
      id: "add",
      label: "Add part",
      icon: <Plus size={18} aria-hidden="true" />,
      content: (close) => (
        <>
          <ul className="px-pick-list">
            {objectKinds.map((kind) => {
              const Icon = icons[kind];
              return (
                <li key={kind}>
                  <button
                    type="button"
                    className="px-pick"
                    disabled={full}
                    onClick={() => {
                      insert(kind);
                      close();
                    }}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {objectNames[kind]}
                  </button>
                </li>
              );
            })}
          </ul>
          {full ? (
            <p className="lab-note">
              The scene holds at most {OBJECT_LIMIT} parts.
            </p>
          ) : null}
        </>
      ),
    },
    {
      id: "templates",
      label: "Templates",
      icon: <LayoutTemplate size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          {(Object.keys(presetNames) as Preset[]).map((id) => (
            <li key={id}>
              <button
                type="button"
                className="px-pick"
                onClick={() => {
                  loadTemplate(id);
                  close();
                }}
              >
                <LayoutTemplate size={15} aria-hidden="true" />
                {id === "blank" ? "Blank scene" : presetNames[id]}
                <small>{TEMPLATE_NOTES[id]}</small>
              </button>
            </li>
          ))}
        </ul>
      ),
    },
    {
      id: "outline",
      label: "Outline",
      icon: <ListTree size={18} aria-hidden="true" />,
      content: (close) => (
        <ul className="px-pick-list">
          <li>
            <button
              type="button"
              className="px-pick"
              aria-pressed={selected === null}
              onClick={() => {
                setSelected(null);
                panels.setInspectorOpen(true);
                close();
              }}
            >
              <SlidersHorizontal size={15} aria-hidden="true" />
              Scene
            </button>
          </li>
          {scene.objects.map((part) => {
            const Icon = icons[part.kind];
            return (
              <li key={part.id}>
                <button
                  type="button"
                  className="px-pick"
                  aria-pressed={part.id === selected}
                  onClick={() => {
                    setSelected(part.id);
                    panels.setInspectorOpen(true);
                    close();
                  }}
                >
                  <Icon size={15} aria-hidden="true" />
                  {part.id}
                </button>
              </li>
            );
          })}
        </ul>
      ),
    },
  ];

  const ObjectIcon = object ? icons[object.kind] : SlidersHorizontal;

  return (
    <LabFrame
      study="motion"
      active={active}
      onStudyChange={onStudyChange}
      documentTitle={`${scene.name} · Physix`}
      title={
        <>
          <NameField
            label="Experiment name"
            value={scene.name}
            onCommit={(name) => apply({ ...scene, name })}
          />
          <UndoRedo
            canUndo={history.canUndo}
            canRedo={history.canRedo}
            onUndo={undo}
            onRedo={redo}
          />
        </>
      }
      controls={
        <>
          <button
            type="button"
            className="lab-button lab-button--dark lab-run"
            onClick={run}
            disabled={!simulation}
            title={
              stopped && !running
                ? "Replay from the start (Space)"
                : "Run or pause (Space)"
            }
          >
            {running ? (
              <Pause size={15} aria-hidden="true" />
            ) : stopped ? (
              <RotateCcw size={15} aria-hidden="true" />
            ) : (
              <Play size={15} aria-hidden="true" />
            )}
            {running ? "Pause" : stopped ? "Replay" : "Run"}
          </button>
          <button
            type="button"
            className="lab-button lab-secondary"
            onClick={advance}
            disabled={!simulation || running || stopped}
            title="Step 1/120 s (.)"
          >
            <SkipForward size={15} aria-hidden="true" />
            <span>Step</span>
          </button>
          <button
            type="button"
            className="lab-button lab-secondary"
            onClick={reset}
            title="Reset the run (R)"
          >
            <RotateCcw size={15} aria-hidden="true" />
            <span>Reset</span>
          </button>
        </>
      }
      status={
        <StatusDot label="Engine" value={engine.value} tone={engine.tone} />
      }
      menu={[
        {
          label: "Scene JSON",
          icon: <Code2 size={15} />,
          onSelect: openJson,
        },
        {
          label: "Sweep…",
          icon: <ChartScatter size={15} />,
          onSelect: () => setSheet("sweep"),
        },
        {
          label: "Export data",
          icon: <Download size={15} />,
          onSelect: () => setSheet("export"),
        },
        {
          label: "Reset camera",
          icon: <Focus size={15} />,
          hint: "F",
          onSelect: () => setViewRevision((value) => value + 1),
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
      railLabel="Scene tools"
      rail={rail}
      sheets={
        <>
          <Sheet
            open={sheet === "json"}
            title="Scene JSON"
            wide
            onClose={() => setSheet(null)}
          >
            <p className="lab-sheet-lead">
              Edit or paste a <code>physix.lab/2</code> scene in SI units, or
              load a <code>physix.experiment/1</code> file to repeat its run.
              Applying is one undo step.
            </p>
            <textarea
              className="lab-json"
              value={json}
              spellCheck={false}
              aria-label="Scene JSON"
              onChange={(event) => {
                setJson(event.currentTarget.value);
                setJsonError("");
              }}
            />
            {jsonError ? (
              <p className="lab-error" role="alert">
                {jsonError}
              </p>
            ) : null}
            <input
              type="file"
              accept=".json,application/json"
              hidden
              ref={jsonFile}
              onChange={async (event) => {
                const input = event.currentTarget;
                const file = input.files?.[0];
                input.value = "";
                if (!file) return;
                if (file.size > FILE_LIMIT) {
                  setJsonError("Choose a JSON file smaller than 16 MB.");
                  return;
                }
                let text: string;
                try {
                  text = await file.text();
                } catch {
                  setJsonError("The selected file could not be read.");
                  return;
                }
                try {
                  const parsed = JSON.parse(text) as unknown;
                  // Experiment files are large, so they load directly.
                  if (isExperiment(parsed)) {
                    importExperiment(parseExperiment(parsed));
                    return;
                  }
                } catch (error) {
                  if (!(error instanceof SyntaxError)) {
                    setJsonError(message(error));
                    return;
                  }
                }
                setJson(text);
                setJsonError("");
              }}
            />
            <div className="lab-sheet-actions">
              <button
                className="lab-button"
                type="button"
                onClick={() => jsonFile.current?.click()}
              >
                <Upload size={15} aria-hidden="true" /> Load file
              </button>
              <button
                className="lab-button"
                type="button"
                onClick={() => downloadScene(scene)}
              >
                <Download size={15} aria-hidden="true" /> Export
              </button>
              <button
                className="lab-button lab-button--dark"
                type="button"
                onClick={importJson}
              >
                Apply scene
              </button>
            </div>
          </Sheet>
          <Sheet
            open={sheet === "export"}
            title="Export data"
            wide
            onClose={() => setSheet(null)}
          >
            {recorded ? (
              <>
                <p className="lab-sheet-lead">
                  Run <code>{recorded.id.slice(7, 19)}</code> ·{" "}
                  {recorded.series.t.length} samples at {recorded.inputs.rate}{" "}
                  Hz · {stopMessage}
                </p>
                <div className="lab-sheet-actions lab-sheet-actions--start">
                  <button
                    className="lab-button"
                    type="button"
                    onClick={() => void exportExperiment()}
                  >
                    <Download size={15} aria-hidden="true" /> Experiment (.json)
                  </button>
                  <button
                    className="lab-button"
                    type="button"
                    onClick={() =>
                      download(
                        `${slug(scene.name)}.csv`,
                        runToCsv([recorded]),
                        "text/csv",
                      )
                    }
                  >
                    <Download size={15} aria-hidden="true" /> Samples (.csv)
                  </button>
                  {sweepRecord ? (
                    <button
                      className="lab-button"
                      type="button"
                      onClick={() =>
                        download(
                          `${slug(scene.name)}.sweep.csv`,
                          sweepToCsv(sweepRecord, sweepFit),
                          "text/csv",
                        )
                      }
                    >
                      <Download size={15} aria-hidden="true" /> Sweep (.csv)
                    </button>
                  ) : null}
                </div>
                <label className="lab-select">
                  <span>Methods summary</span>
                  <textarea
                    className="lab-json lab-methods"
                    readOnly
                    value={methods}
                  />
                </label>
                <div className="lab-sheet-actions">
                  <button
                    className="lab-button lab-button--dark"
                    type="button"
                    onClick={() =>
                      navigator.clipboard.writeText(methods).then(
                        () =>
                          toasts.push({
                            tone: "ok",
                            message: "Copied the methods summary.",
                          }),
                        () =>
                          toasts.push({
                            tone: "warn",
                            message:
                              "The clipboard is unavailable. Select the text to copy it.",
                          }),
                      )
                    }
                  >
                    <Copy size={15} aria-hidden="true" /> Copy
                  </button>
                </div>
              </>
            ) : (
              <p className="lab-sheet-lead">
                {result?.error ?? "Recording the run…"}
              </p>
            )}
          </Sheet>
          <SweepSheet
            open={sheet === "sweep"}
            scene={scene}
            protocol={protocol}
            running={sweep.state?.status === "running"}
            onClose={() => setSheet(null)}
            onRun={(spec) => {
              sweep.start(scene, spec);
              setSheet(null);
              setView("sweep");
              panels.setDockOpen(true);
            }}
          />
          <ShortcutsSheet
            open={sheet === "keys"}
            onClose={() => setSheet(null)}
          />
        </>
      }
    >
      <LabViewport
        scene={scene}
        simulation={simulation}
        selected={selected}
        onSelect={select}
        viewRevision={viewRevision}
      />
      <div className="lab-hud">
        <button
          type="button"
          className="px-icon-button lab-hud-button"
          aria-label="Reset camera"
          title="Reset camera (F)"
          onClick={() => setViewRevision((value) => value + 1)}
        >
          <Focus size={16} aria-hidden="true" />
        </button>
        <span className="lab-hint">Drag to orbit · Scroll to zoom</span>
      </div>

      <FloatingPanel
        title={object ? object.id : "Scene"}
        anchor="right"
        icon={<ObjectIcon size={15} aria-hidden="true" />}
        collapsed={!panels.inspectorOpen}
        onCollapsedChange={(collapsed) => panels.setInspectorOpen(!collapsed)}
        className="lab-inspector"
        actions={
          <>
            <span
              className="lab-info"
              role="img"
              aria-label={help}
              title={help}
            >
              <Info size={15} aria-hidden="true" />
            </span>
            {object ? (
              <button
                type="button"
                className="px-icon-button lab-delete"
                aria-label={`Remove ${object.id}`}
                title="Remove (Delete)"
                onClick={remove}
              >
                <Trash2 size={15} aria-hidden="true" />
              </button>
            ) : null}
          </>
        }
      >
        {object ? (
          <div key={object.id}>
            <p className="lab-kind">{objectNames[object.kind]}</p>
            <ObjectFields object={object} onChange={updateObject} />
            {isBody(object) && ramps.length > 0 ? (
              <label className="lab-select">
                <span>Place on ramp</span>
                <select
                  className="px-input"
                  value=""
                  onChange={(event) => {
                    const ramp = ramps.find(
                      (part) => part.id === event.currentTarget.value,
                    );
                    if (ramp) placeOnRamp(ramp);
                  }}
                >
                  <option value="" disabled>
                    Choose a ramp
                  </option>
                  {ramps.map((ramp) => (
                    <option key={ramp.id} value={ramp.id}>
                      {ramp.id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
        ) : (
          <>
            <div className="lab-fields">
              <UnitInput
                label="Gravity"
                dimension="acceleration"
                unit="m/s²"
                value={scene.gravity}
                {...range(limits.gravity)}
                onCommit={(gravity) => apply({ ...scene, gravity })}
              />
              <UnitInput
                label="Floor friction μ"
                dimension="ratio"
                unit=""
                value={scene.floorFriction}
                {...range(limits.friction)}
                onCommit={(floorFriction) => apply({ ...scene, floorFriction })}
              />
            </div>
            <p className="lab-kind lab-kind--section">Protocol</p>
            <div className="lab-fields">
              <label className="lab-select lab-select--inline">
                <span>Stop at</span>
                <select
                  className="px-input"
                  value={protocol.stop}
                  onChange={(event) =>
                    setProtocol({
                      ...protocol,
                      stop: event.currentTarget.value as Protocol["stop"],
                    })
                  }
                >
                  {stops.map((type) => (
                    <option key={type} value={type}>
                      {EVENT_LABELS[type]}
                    </option>
                  ))}
                  <option value="time">Time limit</option>
                </select>
              </label>
              <UnitInput
                label="Time limit"
                dimension="time"
                unit="s"
                value={protocol.maxTime}
                min={MAX_TIME_LIMITS[0]}
                max={MAX_TIME_LIMITS[1]}
                onCommit={(maxTime) => setProtocol({ ...protocol, maxTime })}
              />
            </div>
          </>
        )}
      </FloatingPanel>

      <Dock
        title="Data"
        summary={summary}
        open={panels.dockOpen}
        onOpenChange={panels.setDockOpen}
        maxFraction={panels.dockMaxFraction}
        defaultHeight={300}
      >
        <MotionData
          scene={scene}
          target={target}
          run={recorded}
          runError={result?.error}
          time={time}
          comparisons={comparisons}
          curves={curves}
          check={stepCheck}
          onCheck={runCheck}
          onExport={() => setSheet("export")}
          view={view}
          onViewChange={setView}
          renderSweep={(switcher) => (
            <SweepData
              state={sweep.state}
              scene={scene}
              color={
                sweep.state
                  ? seriesColour(
                      sweep.state.scene,
                      metricTarget(sweep.state.spec.metric),
                    )
                  : seriesColour(scene, target)
              }
              switcher={switcher}
              onSetup={() => setSheet("sweep")}
              onCancel={sweep.cancel}
              onExport={() => setSheet("export")}
              onFit={sweep.setFit}
            />
          )}
        />
      </Dock>
    </LabFrame>
  );
}
