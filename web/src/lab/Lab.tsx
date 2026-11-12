import { lazy, Suspense, useState } from "react";
import { labHash, replaceHash, type LabLocation, type Study } from "../routes";
import { ToastViewport } from "./ui/Toast";

const MotionStudy = lazy(() =>
  import("./motion/MotionStudy").then((module) => ({
    default: module.MotionStudy,
  })),
);
const StressStudy = lazy(() =>
  import("./stress/StressStudy").then((module) => ({
    default: module.StressStudy,
  })),
);

function Loading({ study }: { study: Study }) {
  return (
    <div className="lab-loading" role="status">
      Opening the {study} study…
    </div>
  );
}

/**
 * The one lab. Both studies stay mounted once opened, so switching keeps each study's
 * scene, history and results (LAB_PLAN.md §3.1).
 */
export function Lab({ location }: { location: LabLocation }) {
  const [study, setStudy] = useState<Study>(location.study);
  const [mounted, setMounted] = useState<ReadonlySet<Study>>(
    () => new Set([location.study]),
  );

  const switchTo = (next: Study) => {
    if (next === study) return;
    setStudy(next);
    setMounted((current) =>
      current.has(next) ? current : new Set([...current, next]),
    );
    replaceHash(labHash({ study: next }));
  };

  return (
    <div className="lab">
      {mounted.has("motion") ? (
        <Suspense
          fallback={study === "motion" ? <Loading study="motion" /> : null}
        >
          <MotionStudy
            active={study === "motion"}
            template={location.template}
            onStudyChange={switchTo}
          />
        </Suspense>
      ) : null}
      {mounted.has("stress") ? (
        <Suspense
          fallback={study === "stress" ? <Loading study="stress" /> : null}
        >
          <StressStudy
            active={study === "stress"}
            example={location.example}
            sheet={location.sheet}
            onStudyChange={switchTo}
          />
        </Suspense>
      ) : null}
      <ToastViewport />
    </div>
  );
}
