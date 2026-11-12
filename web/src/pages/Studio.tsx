/** Interactive studio: edit a part, see the surrogate field live, verify and optimise. */

import { useMemo, useState } from "react";
import type { Case } from "../physics/case";
import {
  examplePlate,
  tractionMagnitude,
  yieldStrength,
} from "../physics/case";
import { solidMask } from "../physics/encoding";
import type { Health } from "../state";
import { useEngine } from "../state";
import { AgentPanel } from "../studio/AgentPanel";
import { CaseEditor } from "../studio/CaseEditor";
import {
  colormapFor,
  FIELD_OPTIONS,
  rangeFor,
  surrogateField,
  useSurrogate,
  type FieldKey,
} from "../studio/fields";
import { OptimizePanel } from "../studio/OptimizePanel";
import { VerifyPanel } from "../studio/VerifyPanel";
import { Badge, Segmented, Spinner, Stat } from "../ui/controls";
import { Colorbar, FieldView } from "../ui/FieldView";
import { mm, mpa, ms, pct } from "../ui/units";

type Panel = "verify" | "optimize" | "agent";

const REASONS: Record<string, string> = {
  out_of_domain: "outside the training domain",
  high_disagreement: "the ensemble members disagree",
  non_finite_prediction: "non-finite prediction",
};

export function Studio({ health }: { health: Health }) {
  const [c, setC] = useState<Case>(examplePlate);
  const [field, setField] = useState<FieldKey>("von_mises");
  const [panel, setPanel] = useState<Panel>("verify");
  const [invalidField, setInvalidField] = useState<string | null>(null);
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

  const verdict = !pred ? null : pred.accepted ? (
    <Badge
      tone="ok"
      title="Inside the training domain and the ensemble agrees within the calibrated threshold"
    >
      Surrogate accepted
    </Badge>
  ) : (
    <Badge
      tone="warn"
      title="The service would answer this case with the FEM solver"
    >
      FEM fallback: {REASONS[pred.reason ?? ""] ?? pred.reason}
    </Badge>
  );

  return (
    <div className="studio">
      <aside className="studio-side">
        <CaseEditor
          c={c}
          invalidField={invalidField}
          onChange={(next) => {
            setInvalidField(null);
            setC(next);
          }}
        />
      </aside>

      <section className="studio-main">
        <div className="card field-card">
          <div className="field-toolbar">
            <Segmented<FieldKey>
              label="Field"
              value={field}
              onChange={setField}
              options={FIELD_OPTIONS}
            />
            <div className="field-meta">
              {verdict}
              {pred && (
                <span
                  className="muted small"
                  title="Encode + every ONNX member + ensemble statistics, in this tab"
                >
                  {ms(pred.timing.total_ms)} in-browser
                </span>
              )}
            </div>
          </div>
          <div className="field-stage">
            {engine.status === "loading" && (
              <div className="stage-overlay">
                <Spinner
                  label={`Loading the ensemble… ${Math.round(engine.progress * 100)}%`}
                />
              </div>
            )}
            {engine.status === "error" && (
              <div className="stage-overlay">
                <p className="callout tone-bad">
                  The in-browser model could not load: {engine.error} Export a
                  bundle with <code>make export</code>; FEM checks still work.
                </p>
              </div>
            )}
            {sur.blocked && (
              <div className="stage-banner">
                <Badge tone="warn">Paused</Badge> {sur.blocked}
              </div>
            )}
            <FieldView
              c={sur.blocked ? c : shownCase}
              values={sur.blocked ? null : values}
              mask={mask}
              range={range}
              colormap={colormapFor(field)}
              editable
              onHolesChange={(holes) =>
                setC({ ...c, geometry: { ...c.geometry, holes } })
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
          <div className="field-foot">
            <Colorbar
              range={range}
              colormap={colormapFor(field)}
              label={FIELD_OPTIONS.find((o) => o.value === field)?.title ?? ""}
              format={(v) => mpa(v)}
            />
            <p className="muted small">
              Drag a hole to move it; drag its handle to resize. Hover for local
              values.
            </p>
          </div>
        </div>

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
              sf == null ? undefined : sf >= 2 ? "ok" : sf >= 1 ? "warn" : "bad"
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
        {pred && !pred.domain.in_domain && (
          <div className="callout tone-warn">
            <strong>Outside the training domain.</strong> The surrogate field is
            shown for orientation only; the service answers with FEM.
            <ul>
              {pred.domain.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="card">
          <div className="panel-tabs">
            <Segmented<Panel>
              label="Panel"
              value={panel}
              onChange={setPanel}
              options={[
                { value: "verify", label: "Verify with FEM" },
                { value: "optimize", label: "Optimise" },
                { value: "agent", label: "Use from an agent" },
              ]}
            />
            <span className={`api-dot ${health.online ? "is-on" : ""}`}>
              {health.online
                ? `Solver API online · ${health.solver}`
                : "Solver API offline"}
            </span>
          </div>
          {panel === "verify" && (
            <VerifyPanel
              c={c}
              pred={sur.forCase === c ? pred : null}
              online={health.online}
              onInvalid={setInvalidField}
            />
          )}
          {panel === "optimize" && (
            <OptimizePanel c={c} online={health.online} onApply={setC} />
          )}
          {panel === "agent" && <AgentPanel c={c} />}
        </div>
      </section>
    </div>
  );
}
