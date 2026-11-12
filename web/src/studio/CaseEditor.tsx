/** Parametric case editor. Inputs are shown in mm / MPa / N and stored in SI. */

import type { Case, Family, Hole } from "../physics/case";
import {
  cloneCase,
  exampleBracket,
  examplePlate,
  loadEdgeLength,
  MATERIALS,
  resultantForce,
  traction,
} from "../physics/case";
import { NumField, Segmented } from "../ui/controls";
import { gpa, mpa, newtons, plain } from "../ui/units";

export const PRESETS: { id: string; label: string; make: () => Case }[] = [
  { id: "plate", label: "Plate, centre hole", make: examplePlate },
  {
    id: "plate-3",
    label: "Plate, three holes",
    make: () => {
      const c = examplePlate();
      c.geometry = {
        width: 0.3,
        height: 0.12,
        holes: [
          { x: 0.07, y: 0.06, radius: 0.02 },
          { x: 0.16, y: 0.04, radius: 0.012 },
          { x: 0.23, y: 0.08, radius: 0.015 },
        ],
      };
      c.material = { name: "aluminium_6061", young: 68.9e9, poisson: 0.33 };
      return c;
    },
  },
  {
    id: "plate-shear",
    label: "Plate, end shear",
    make: () => {
      const c = examplePlate();
      c.geometry.holes = [
        { x: 0.07, y: 0.04, radius: 0.01 },
        { x: 0.14, y: 0.04, radius: 0.01 },
      ];
      c.load = { kind: "force", x: 0, y: -2000 };
      return c;
    },
  },
  { id: "bracket", label: "L-bracket, tip load", make: exampleBracket },
  {
    id: "bracket-steel",
    label: "L-bracket, two holes",
    make: () => {
      const c = exampleBracket();
      c.geometry.holes = [
        { x: 0.02, y: 0.075, radius: 0.007 },
        { x: 0.15, y: 0.015, radius: 0.007 },
      ];
      c.material = { name: "steel", young: 210e9, poisson: 0.3 };
      c.load = { kind: "force", x: 0, y: -2500 };
      return c;
    },
  },
];

export function CaseEditor({
  c,
  onChange,
  invalidField,
}: {
  c: Case;
  onChange: (c: Case) => void;
  invalidField?: string | null;
}) {
  const g = c.geometry;
  const edit = (fn: (draft: Case) => void) => {
    const next = cloneCase(c);
    fn(next);
    onChange(next);
  };
  const setHole = (i: number, patch: Partial<Hole>) =>
    edit((d) => Object.assign(d.geometry.holes[i], patch));
  const bad = (field: string) =>
    !!invalidField && invalidField.startsWith(field);
  const [tx, ty] = traction(c);
  const [fx, fy] = resultantForce(c);
  const material = MATERIALS[c.material.name];
  const maxHoles = c.family === "plate" ? 6 : 4;

  const setFamily = (f: Family) => {
    if (f !== c.family)
      onChange(f === "plate" ? examplePlate() : exampleBracket());
  };

  const addHole = () =>
    edit((d) => {
      const r = 0.05 * d.geometry.width;
      const x =
        d.family === "plate" ? 0.5 * d.geometry.width : 0.75 * d.geometry.width;
      const y =
        d.family === "plate"
          ? 0.5 * d.geometry.height
          : 0.5 * (d.geometry.flange_height ?? r * 3);
      d.geometry.holes.push({
        x,
        y,
        radius: Math.min(
          r,
          0.3 * (d.geometry.flange_height ?? d.geometry.height),
        ),
      });
    });

  return (
    <div className="editor">
      <section className="editor-section">
        <header>
          <h3>Part</h3>
          <Segmented<Family>
            label="Part family"
            value={c.family}
            onChange={setFamily}
            options={[
              { value: "plate", label: "Plate" },
              { value: "bracket", label: "Bracket" },
            ]}
          />
        </header>
        <label className="select">
          <span>Preset</span>
          <select
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) onChange(p.make());
            }}
          >
            <option value="" disabled>
              Load a preset…
            </option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid2">
          <NumField
            label="Width"
            unit="mm"
            scale={1e3}
            value={g.width}
            invalid={bad("geometry.width")}
            onChange={(v) => edit((d) => (d.geometry.width = v))}
          />
          <NumField
            label="Height"
            unit="mm"
            scale={1e3}
            value={g.height}
            invalid={bad("geometry.height")}
            onChange={(v) => edit((d) => (d.geometry.height = v))}
          />
          {c.family === "bracket" && (
            <>
              <NumField
                label="Web width"
                unit="mm"
                scale={1e3}
                value={g.web_width ?? 0}
                invalid={bad("geometry.web_width")}
                onChange={(v) => edit((d) => (d.geometry.web_width = v))}
              />
              <NumField
                label="Flange height"
                unit="mm"
                scale={1e3}
                value={g.flange_height ?? 0}
                invalid={bad("geometry.flange_height")}
                onChange={(v) => edit((d) => (d.geometry.flange_height = v))}
              />
              <NumField
                label="Fillet radius"
                unit="mm"
                scale={1e3}
                value={g.fillet_radius ?? 0}
                invalid={bad("geometry.fillet_radius")}
                onChange={(v) => edit((d) => (d.geometry.fillet_radius = v))}
              />
            </>
          )}
          <NumField
            label="Thickness"
            unit="mm"
            scale={1e3}
            value={c.thickness}
            invalid={bad("thickness")}
            onChange={(v) => edit((d) => (d.thickness = v))}
          />
        </div>
      </section>

      <section className="editor-section">
        <header>
          <h3>Holes</h3>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={g.holes.length >= maxHoles}
            onClick={addHole}
          >
            + Add hole
          </button>
        </header>
        {g.holes.length === 0 && (
          <p className="muted small">
            No holes. Add one, or drag holes directly on the field.
          </p>
        )}
        {g.holes.map((h, i) => (
          <div
            key={i}
            className={`hole-row ${bad(`geometry.holes[${i}]`) ? "is-invalid" : ""}`}
          >
            <span className="hole-index">{i + 1}</span>
            <NumField
              label="x"
              unit="mm"
              scale={1e3}
              value={h.x}
              onChange={(v) => setHole(i, { x: v })}
            />
            <NumField
              label="y"
              unit="mm"
              scale={1e3}
              value={h.y}
              onChange={(v) => setHole(i, { y: v })}
            />
            <NumField
              label="r"
              unit="mm"
              scale={1e3}
              value={h.radius}
              onChange={(v) => setHole(i, { radius: v })}
            />
            <button
              type="button"
              className="icon-btn"
              aria-label={`Remove hole ${i + 1}`}
              onClick={() => edit((d) => d.geometry.holes.splice(i, 1))}
            >
              ×
            </button>
          </div>
        ))}
      </section>

      <section className="editor-section">
        <header>
          <h3>Material</h3>
        </header>
        <label className="select">
          <span>Alloy</span>
          <select
            value={material ? c.material.name : "custom"}
            onChange={(e) => {
              const m = MATERIALS[e.target.value];
              if (m)
                edit(
                  (d) =>
                    (d.material = {
                      name: m.name,
                      young: m.young,
                      poisson: m.poisson,
                    }),
                );
              else
                edit((d) => (d.material = { ...d.material, name: "custom" }));
            }}
          >
            {Object.values(MATERIALS).map((m) => (
              <option key={m.name} value={m.name}>
                {m.label}
              </option>
            ))}
            <option value="custom">Custom</option>
          </select>
        </label>
        {material ? (
          <p className="muted small">
            E {gpa(material.young)} · ν {plain(material.poisson, 3)} · yield{" "}
            {mpa(material.yield)}
          </p>
        ) : (
          <div className="grid2">
            <NumField
              label="Young's modulus"
              unit="GPa"
              scale={1e-9}
              value={c.material.young}
              onChange={(v) => edit((d) => (d.material.young = v))}
            />
            <NumField
              label="Poisson's ratio"
              value={c.material.poisson}
              step={0.01}
              onChange={(v) => edit((d) => (d.material.poisson = v))}
            />
          </div>
        )}
      </section>

      <section className="editor-section">
        <header>
          <h3>Load</h3>
          <Segmented<"traction" | "force">
            label="Load kind"
            value={c.load.kind}
            onChange={(kind) =>
              edit((d) => {
                if (kind === d.load.kind) return;
                const area = loadEdgeLength(d) * d.thickness;
                d.load =
                  kind === "force"
                    ? { kind, x: tx * area, y: ty * area }
                    : { kind, x: tx, y: ty };
              })
            }
            options={[
              {
                value: "traction",
                label: "Traction",
                title: "Uniform traction on the loaded edge",
              },
              {
                value: "force",
                label: "Force",
                title: "Resultant force, spread over the edge",
              },
            ]}
          />
        </header>
        {c.load.kind === "traction" ? (
          <div className="grid2">
            <NumField
              label="tx"
              unit="MPa"
              scale={1e-6}
              value={c.load.x}
              onChange={(v) => edit((d) => (d.load.x = v))}
            />
            <NumField
              label="ty"
              unit="MPa"
              scale={1e-6}
              value={c.load.y}
              onChange={(v) => edit((d) => (d.load.y = v))}
            />
          </div>
        ) : (
          <div className="grid2">
            <NumField
              label="Fx"
              unit="N"
              value={c.load.x}
              onChange={(v) => edit((d) => (d.load.x = v))}
            />
            <NumField
              label="Fy"
              unit="N"
              value={c.load.y}
              onChange={(v) => edit((d) => (d.load.y = v))}
            />
          </div>
        )}
        <p className="muted small">
          {c.load.kind === "traction"
            ? `Resultant ${newtons(fx)}, ${newtons(fy)}`
            : `Traction ${mpa(tx)}, ${mpa(ty)}`}{" "}
          on the {c.family === "plate" ? "right edge" : "flange tip"};{" "}
          {c.family === "plate" ? "left edge" : "top of the web"} clamped.
        </p>
      </section>
    </div>
  );
}
