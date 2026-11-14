/** Loads the same Python solver and request contract used by the local service. */
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.29.4/full/";
const SCIKIT_FEM =
  "https://files.pythonhosted.org/packages/5b/13/d46cf943bd1b04b1b010094eb08493d6660c99c49652fa46cf7c3bf36ab5/scikit_fem-12.0.2-py3-none-any.whl";

const sources = import.meta.glob<string>(
  [
    "../../../physics/{__init__,case,convergence,examples,geometry,materials,mesh,solver}.py",
    "../../../data/{__init__,domain,labels,raster}.py",
    "../../../model/{__init__,calibrate,ensemble}.py",
    "../../../mcp/physix_mcp/{__init__,http_api,optimize,service}.py",
  ],
  { eager: true, query: "?raw", import: "default" },
);

type PythonRuntime = {
  FS: {
    mkdirTree(path: string): void;
    writeFile(path: string, source: string): void;
  };
  globals: { set(key: string, value: string): void; delete(key: string): void };
  loadPackage(url: string): Promise<void>;
  runPython(source: string): unknown;
};

const bootstrap = `
import sys, json, time
sys.path.insert(0, "/physix")
from physix_mcp.service import PhysixService
from physix_mcp.http_api import _clean
service = PhysixService(label_store=None)

def request(path, data):
    body = json.loads(data)
    started = time.perf_counter()
    if path == "/api/verify":
        response = service.verify(
            body["case"], prediction=body.get("prediction"),
            include_field=bool(body.get("include_field")), include_mesh=bool(body.get("include_mesh")),
            mesh_preset=body.get("mesh_preset")
        )
    elif path == "/api/convergence":
        response = service.convergence(
            body["case"], presets=body.get("presets"), probes=body.get("probes")
        )
    elif path == "/api/optimize":
        response = service.optimize(body)
    elif path == "/api/predict":
        response = service.predict(
            body["case"], force_fem=True,
            include_field=bool(body.get("include_field")), include_mesh=bool(body.get("include_mesh"))
        )
    else:
        response = {"error": "not_found", "message": "This operation is unavailable in the browser."}
    if "error" not in response:
        timing = response.setdefault("timing", {})
        timing["browser_ms"] = 1000 * (time.perf_counter() - started)
        if path == "/api/optimize":
            timing["boundary"] = "browser worker, includes FEM verification"
        elif path == "/api/convergence":
            timing["boundary"] = "browser worker, three solves and comparisons"
    return json.dumps(_clean(response), allow_nan=False)
`;

let runtime: Promise<PythonRuntime> | undefined;
async function loadSolver(): Promise<PythonRuntime> {
  const moduleUrl = `${PYODIDE}pyodide.mjs`;
  const { loadPyodide } = (await import(/* @vite-ignore */ moduleUrl)) as {
    loadPyodide: (options: {
      indexURL: string;
      packages: string[];
    }) => Promise<PythonRuntime>;
  };
  const python = await loadPyodide({
    indexURL: PYODIDE,
    packages: ["numpy", "scipy"],
  });
  await python.loadPackage(SCIKIT_FEM);
  for (const [name, content] of Object.entries(sources)) {
    const path = `/physix/${name.replace(/^\.\.\/\.\.\/\.\.\/(mcp\/)?/, "")}`;
    python.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
    python.FS.writeFile(path, content);
  }
  python.runPython(bootstrap);
  return python;
}

self.onmessage = async ({
  data,
}: MessageEvent<{ id: number; path: string; body: unknown }>) => {
  const { id, path, body } = data;
  runtime ??= loadSolver().catch((error: unknown) => {
    runtime = undefined;
    throw error;
  });
  try {
    const python = await runtime;
    python.globals.set("request_path", path);
    python.globals.set("request_body", JSON.stringify(body));
    let payload: unknown;
    try {
      payload = JSON.parse(
        python.runPython("request(request_path, request_body)") as string,
      );
    } finally {
      python.globals.delete("request_path");
      python.globals.delete("request_body");
    }
    self.postMessage({ id, payload });
  } catch (error) {
    console.error("Physix browser solver:", error);
    self.postMessage({
      id,
      payload: {
        error: "solver_unavailable",
        message:
          "The browser could not complete the FEM calculation. Try again or use a smaller search budget.",
      },
    });
  }
};
