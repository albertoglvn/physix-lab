import { lazy, Suspense } from "react";
import { Home } from "./pages/Home";
import { useRoute } from "./routes";

const Lab = lazy(() =>
  import("./lab/Lab").then((module) => ({ default: module.Lab })),
);
const StressApp = lazy(() =>
  import("./pages/StressApp").then((module) => ({ default: module.StressApp })),
);

export function App() {
  const route = useRoute();
  if (route === "/lab" || route.startsWith("/lab/")) {
    const segment = route.split("/")[2];
    const preset =
      segment === "friction" || segment === "pulley" || segment === "blank"
        ? segment
        : "incline";
    return (
      <Suspense
        fallback={
          <div className="pastoral route-loading" role="status">
            Opening the lab…
          </div>
        }
      >
        <Lab key={preset} preset={preset} />
      </Suspense>
    );
  }
  if (
    route === "/stress" ||
    route.startsWith("/studio") ||
    route.startsWith("/model")
  ) {
    return (
      <Suspense
        fallback={
          <div className="route-loading" role="status">
            Opening stress analysis…
          </div>
        }
      >
        <StressApp route={route} />
      </Suspense>
    );
  }
  return <Home route={route} />;
}
