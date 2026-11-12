/**
 * Nonlinear least squares by Levenberg–Marquardt with a central-difference Jacobian.
 *
 * With reading uncertainties σᵢ the fit minimises χ² = Σ ((yᵢ − f(xᵢ)) / σᵢ)² and treats σ
 * as absolute: the covariance is (JᵀWJ)⁻¹, and a reduced χ² near 1 says the σ were
 * consistent with the scatter. Without σ every point has weight 1 and the covariance is
 * scaled by the residual variance SSR / (n − k).
 */

import { compileExpression, type CompiledExpression } from "./expression";

export type FitOptions = {
  /** One standard uncertainty per point, or one for all points. */
  sigma?: number | readonly number[];
  maxIterations?: number;
};

export type FitParameter = { name: string; value: number; se: number };

export type FitResult = {
  expression: string;
  parameters: FitParameter[];
  covariance: number[][];
  /** Points used, after dropping non-finite ones. */
  n: number;
  dof: number;
  /** 1 − SSR/SST on the unweighted residuals. */
  r2: number;
  /** Sum of squared unweighted residuals. */
  ssr: number;
  /** χ² and χ²/dof, present only when uncertainties were given. */
  chi2?: number;
  reducedChi2?: number;
  /** y − f(x) for every input point, NaN where the point was dropped. */
  residuals: number[];
  iterations: number;
  converged: boolean;
};

export class FitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FitError";
  }
}

/** Solves A x = b for a small dense system by Gaussian elimination with pivoting. */
export function solve(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++)
      if (Math.abs(a[row][column]) > Math.abs(a[pivot][column])) pivot = row;
    if (!(Math.abs(a[pivot][column]) > 1e-300)) return null;
    [a[column], a[pivot]] = [a[pivot], a[column]];
    for (let row = column + 1; row < n; row++) {
      const factor = a[row][column] / a[column][column];
      for (let k = column; k <= n; k++) a[row][k] -= factor * a[column][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let row = n - 1; row >= 0; row--) {
    let sum = a[row][n];
    for (let k = row + 1; k < n; k++) sum -= a[row][k] * x[k];
    x[row] = sum / a[row][row];
  }
  return x;
}

/** Inverse of a small symmetric matrix, or null when it is singular. */
export function invert(matrix: number[][]): number[][] | null {
  const n = matrix.length;
  const columns: number[][] = [];
  for (let k = 0; k < n; k++) {
    const unit = new Array<number>(n).fill(0);
    unit[k] = 1;
    const column = solve(matrix, unit);
    if (!column || column.some((v) => !Number.isFinite(v))) return null;
    columns.push(column);
  }
  return matrix.map((_, row) => columns.map((column) => column[row]));
}

type Model = (x: number, p: readonly number[]) => number;

const step = (value: number) => 1e-6 * Math.max(Math.abs(value), 1e-3);

/** ∂f/∂p at x by central differences. */
export function gradient(f: Model, x: number, p: readonly number[]): number[] {
  return p.map((value, k) => {
    const h = step(value);
    const plus = [...p];
    const minus = [...p];
    plus[k] = value + h;
    minus[k] = value - h;
    return (f(x, plus) - f(x, minus)) / (2 * h);
  });
}

/** Fits `f` with parameters `names` from the starting values `start`. */
export function leastSquares(
  f: Model,
  names: readonly string[],
  xs: readonly number[],
  ys: readonly number[],
  start: readonly number[],
  options: FitOptions = {},
  expression = "",
): FitResult {
  if (xs.length !== ys.length)
    throw new FitError("x and y need the same length.");
  const k = names.length;
  if (k === 0) throw new FitError("The model has no parameters to fit.");
  const sigmaOf = (index: number) =>
    options.sigma === undefined
      ? 1
      : typeof options.sigma === "number"
        ? options.sigma
        : options.sigma[index];
  const weighted = options.sigma !== undefined;
  const used = xs
    .map((_, index) => index)
    .filter(
      (index) =>
        Number.isFinite(xs[index]) &&
        Number.isFinite(ys[index]) &&
        (!weighted || sigmaOf(index) > 0),
    );
  const n = used.length;
  if (n <= k)
    throw new FitError(
      `Fitting ${k} parameter${k === 1 ? "" : "s"} needs at least ${k + 1} points; there ${n === 1 ? "is" : "are"} ${n}.`,
    );
  const x = used.map((index) => xs[index]);
  const y = used.map((index) => ys[index]);
  const w = used.map((index) => 1 / sigmaOf(index) ** 2);

  const cost = (p: readonly number[]) => {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += w[i] * (y[i] - f(x[i], p)) ** 2;
    return sum;
  };

  // Normal equations JᵀWJ and JᵀW r at p.
  const normal = (p: readonly number[]) => {
    const jtj = Array.from({ length: k }, () => new Array<number>(k).fill(0));
    const jtr = new Array<number>(k).fill(0);
    for (let i = 0; i < n; i++) {
      const g = gradient(f, x[i], p);
      const r = y[i] - f(x[i], p);
      for (let a = 0; a < k; a++) {
        jtr[a] += w[i] * g[a] * r;
        for (let b = 0; b <= a; b++) jtj[a][b] += w[i] * g[a] * g[b];
      }
    }
    for (let a = 0; a < k; a++)
      for (let b = a + 1; b < k; b++) jtj[a][b] = jtj[b][a];
    return { jtj, jtr };
  };

  let p = [...start];
  let current = cost(p);
  if (!Number.isFinite(current))
    throw new FitError(
      "The model is not finite at the starting values; try other starting values.",
    );
  let lambda = 1e-3;
  let converged = false;
  let iterations = 0;
  const maxIterations = options.maxIterations ?? 200;
  while (iterations < maxIterations) {
    iterations++;
    const { jtj, jtr } = normal(p);
    let improved = false;
    while (lambda < 1e16) {
      const damped = jtj.map((row, a) =>
        row.map((value, b) => (a === b ? value * (1 + lambda) : value)),
      );
      const delta = solve(damped, jtr);
      if (!delta) {
        lambda *= 10;
        continue;
      }
      const trial = p.map((value, a) => value + delta[a]);
      const next = cost(trial);
      if (Number.isFinite(next) && next <= current) {
        const change = Math.max(
          ...delta.map((d, a) => Math.abs(d) / (Math.abs(p[a]) + 1e-12)),
        );
        const drop = current - next;
        p = trial;
        current = next;
        lambda = Math.max(lambda / 10, 1e-12);
        improved = true;
        if (change < 1e-10 || drop <= 1e-14 * (current + 1e-300))
          converged = true;
        break;
      }
      lambda *= 10;
    }
    if (!improved) {
      // No step lowers the cost: p is a minimum to working precision.
      converged = true;
      break;
    }
    if (converged) break;
  }

  const { jtj } = normal(p);
  const inverse = invert(jtj);
  if (!inverse)
    throw new FitError(
      "The parameters are not separately determined by these points; fix one or add points.",
    );
  const dof = n - k;
  const residuals = xs.map(() => Number.NaN);
  let ssr = 0;
  used.forEach((index, i) => {
    const r = y[i] - f(x[i], p);
    residuals[index] = r;
    ssr += r * r;
  });
  const scale = weighted ? 1 : ssr / dof;
  const covariance = inverse.map((row) => row.map((value) => value * scale));
  const mean = y.reduce((sum, value) => sum + value, 0) / n;
  const sst = y.reduce((sum, value) => sum + (value - mean) ** 2, 0);
  return {
    expression,
    parameters: names.map((name, a) => ({
      name,
      value: p[a],
      se: Math.sqrt(Math.max(covariance[a][a], 0)),
    })),
    covariance,
    n,
    dof,
    r2: sst > 0 ? 1 - ssr / sst : Number.NaN,
    ssr,
    ...(weighted ? { chi2: current, reducedChi2: current / dof } : {}),
    residuals,
    iterations,
    converged,
  };
}

/** Value and standard error of the fitted curve at x, by the delta method. */
export function bandAt(
  f: Model,
  result: FitResult,
  x: number,
): { value: number; se: number } {
  const p = result.parameters.map((parameter) => parameter.value);
  const g = gradient(f, x, p);
  let variance = 0;
  for (let a = 0; a < g.length; a++)
    for (let b = 0; b < g.length; b++)
      variance += g[a] * result.covariance[a][b] * g[b];
  return { value: f(x, p), se: Math.sqrt(Math.max(variance, 0)) };
}

/** Coverage factor of the drawn band: ±2 standard errors, about 95 % for a normal error. */
export const BAND_COVERAGE = 2;

export type FitModelId =
  | "linear"
  | "quadratic"
  | "cubic"
  | "power"
  | "exponential"
  | "incline"
  | "custom";

export type FitPreset = {
  id: Exclude<FitModelId, "custom">;
  label: string;
  expression: string;
  /** Starting values from the data, in the expression's parameter order. */
  guess: (xs: number[], ys: number[], compiled: CompiledExpression) => number[];
};

/** Least-squares polynomial coefficients, lowest degree first, as a starting guess. */
export function polynomialGuess(
  xs: readonly number[],
  ys: readonly number[],
  degree: number,
): number[] {
  const size = degree + 1;
  const ata = Array.from({ length: size }, () =>
    new Array<number>(size).fill(0),
  );
  const aty = new Array<number>(size).fill(0);
  xs.forEach((x, index) => {
    if (!Number.isFinite(x) || !Number.isFinite(ys[index])) return;
    const powers = Array.from({ length: size }, (_, k) => x ** k);
    for (let a = 0; a < size; a++) {
      aty[a] += powers[a] * ys[index];
      for (let b = 0; b < size; b++) ata[a][b] += powers[a] * powers[b];
    }
  });
  return solve(ata, aty) ?? new Array<number>(size).fill(0);
}

const logLinear = (xs: number[], ys: number[], logX: boolean) => {
  const pairs = xs
    .map((x, index) => [x, ys[index]] as const)
    .filter(([x, y]) => y > 0 && (!logX || x > 0));
  if (pairs.length < 2) return null;
  const [c0, c1] = polynomialGuess(
    pairs.map(([x]) => (logX ? Math.log(x) : x)),
    pairs.map(([, y]) => Math.log(y)),
    1,
  );
  return [Math.exp(c0), c1];
};

export const FIT_PRESETS: readonly FitPreset[] = [
  {
    id: "linear",
    label: "Linear",
    expression: "a + b*x",
    guess: (xs, ys) => polynomialGuess(xs, ys, 1),
  },
  {
    id: "quadratic",
    label: "Quadratic",
    expression: "a + b*x + c*x^2",
    guess: (xs, ys) => polynomialGuess(xs, ys, 2),
  },
  {
    id: "cubic",
    label: "Cubic",
    expression: "a + b*x + c*x^2 + d*x^3",
    guess: (xs, ys) => polynomialGuess(xs, ys, 3),
  },
  {
    id: "power",
    label: "Power law",
    expression: "a*x^b",
    guess: (xs, ys) => logLinear(xs, ys, true) ?? [1, 1],
  },
  {
    id: "exponential",
    label: "Exponential",
    expression: "a*exp(b*x)",
    guess: (xs, ys) => logLinear(xs, ys, false) ?? [1, 0],
  },
  {
    id: "incline",
    label: "Incline g(sin θ − μ cos θ)",
    expression: "g*(sin(x*deg) - mu*cos(x*deg))",
    guess: () => [0.3],
  },
];

export const presetById = (id: FitModelId) =>
  FIT_PRESETS.find((preset) => preset.id === id);

/**
 * Fits an expression in x to the points. Constants such as `g` come from the caller;
 * every other name is a parameter, started from `start` or the preset's guess, else 1.
 */
export function fitExpression(
  expression: string,
  xs: number[],
  ys: number[],
  {
    constants = {},
    start,
    preset,
    ...options
  }: FitOptions & {
    constants?: Record<string, number>;
    start?: Record<string, number>;
    preset?: FitPreset;
  } = {},
): { result: FitResult; compiled: CompiledExpression } {
  const compiled = compileExpression(expression, constants);
  const guess = preset?.guess(xs, ys, compiled);
  const initial = compiled.parameters.map(
    (name, index) => start?.[name] ?? guess?.[index] ?? 1,
  );
  return {
    compiled,
    result: leastSquares(
      compiled.evaluate,
      compiled.parameters,
      xs,
      ys,
      initial,
      options,
      expression,
    ),
  };
}
