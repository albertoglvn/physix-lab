import { lazy, Suspense, useEffect, useState } from "react";
import { labHash, replaceHash, type LabLocation, type Study } from "../routes";
import { loadShared, type SharedStart } from "./shared";
import { ToastViewport } from "./ui/Toast";
import { toasts } from "./ui/toastStore";

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
 * scene, history and results (LAB_PLAN.md §3.1). A share link's scene or case is decoded
 * and validated before its study mounts; a bad link opens the default with a notice.
 */
export function Lab({ location }: { location: LabLocation }) {
  const [study, setStudy] = useState<Study>(location.study);
  const [mounted, setMounted] = useState<ReadonlySet<Study>>(
    () => new Set([location.study]),
  );
  const pending = location.scene ?? location.case;
  const [start, setStart] = useState<SharedStart | null>(pending ? null : {});

  useEffect(() => {
    if (!pending) return;
    let live = true;
    void loadShared({
      study: location.study,
      scene: location.scene,
      case: location.case,
    }).then((result) => {
      if (!live) return;
      if (result.error) toasts.push({ tone: "bad", message: result.error });
      setStart(result);
    });
    return () => {
      live = false;
    };
  }, [pending, location.study, location.scene, location.case]);

  const switchTo = (next: Study) => {
    if (next === study) return;
    setStudy(next);
    setMounted((current) =>
      current.has(next) ? current : new Set([...current, next]),
    );
    replaceHash(labHash({ study: next }));
  };

  if (!start)
    return (
      <div className="lab">
        <Loading study={location.study} />
        <ToastViewport />
      </div>
    );

  return (
    <div className="lab">
      {mounted.has("motion") ? (
        <Suspense
          fallback={study === "motion" ? <Loading study="motion" /> : null}
        >
          <MotionStudy
            active={study === "motion"}
            template={location.template}
            initialScene={start.scene}
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
            initialCase={start.case}
            onStudyChange={switchTo}
          />
        </Suspense>
      ) : null}
      <ToastViewport />
    </div>
  );
}
