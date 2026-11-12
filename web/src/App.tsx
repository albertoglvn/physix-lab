import { lazy, Suspense } from "react";
import { Home } from "./pages/Home";
import {
  legacyRedirect,
  parseHash,
  parseLabQuery,
  replaceHash,
  useHashLocation,
} from "./routes";

const Lab = lazy(() =>
  import("./lab/Lab").then((module) => ({ default: module.Lab })),
);

export function App() {
  const current = useHashLocation();
  const redirect = legacyRedirect(current.path);
  if (redirect) replaceHash(redirect);
  const { path, query } = redirect ? parseHash(redirect) : current;
  const hash = redirect ?? current.hash;

  if (path === "/lab")
    return (
      <Suspense
        fallback={
          <div className="pastoral route-loading" role="status">
            Opening the lab…
          </div>
        }
      >
        <Lab key={hash} location={parseLabQuery(query)} />
      </Suspense>
    );
  return <Home route={path} />;
}
