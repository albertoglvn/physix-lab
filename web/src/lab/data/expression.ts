/**
 * A small arithmetic language for fit models, parsed by hand and compiled to closures. It
 * never evaluates text as code. Grammar, loosest first:
 *
 *   sum     = product (("+" | "−") product)*
 *   product = unary (("*" | "/") unary)*
 *   unary   = "−" unary | power
 *   power   = primary ("^" unary)?          right-associative, so −x^2 is −(x^2)
 *   primary = number | name | name "(" sum ")" | "(" sum ")"
 *
 * `x` is the swept variable. Other names are constants, when the caller provides them, or
 * fit parameters, in order of first appearance.
 */

export const FUNCTIONS: Readonly<Record<string, (value: number) => number>> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  exp: Math.exp,
  log: Math.log,
  sqrt: Math.sqrt,
  abs: Math.abs,
};

/** Constants every expression can use; callers add their own, such as `g`. */
export const BASE_CONSTANTS: Readonly<Record<string, number>> = {
  pi: Math.PI,
  deg: Math.PI / 180,
};

export const MAX_EXPRESSION_LENGTH = 200;
export const MAX_PARAMETERS = 6;

export class ExpressionError extends Error {
  constructor(
    message: string,
    /** Index in the source where the problem starts. */
    readonly position: number,
  ) {
    super(message);
    this.name = "ExpressionError";
  }
}

export type CompiledExpression = {
  source: string;
  /** Fit parameters in order of first appearance. */
  parameters: string[];
  /** Constants the expression uses, with their values. */
  constants: Record<string, number>;
  evaluate: (x: number, parameters: readonly number[]) => number;
};

type Token =
  | { kind: "number"; value: number; at: number }
  | { kind: "name"; name: string; at: number }
  | { kind: "op"; op: string; at: number }
  | { kind: "end"; at: number };

type Node = (x: number, p: readonly number[]) => number;

const NAME = /[A-Za-z_][A-Za-z0-9_]*/y;
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source[at];
    if (/\s/.test(char)) {
      at++;
      continue;
    }
    NUMBER.lastIndex = at;
    const number = NUMBER.exec(source);
    if (number) {
      tokens.push({ kind: "number", value: Number(number[0]), at });
      at += number[0].length;
      continue;
    }
    NAME.lastIndex = at;
    const name = NAME.exec(source);
    if (name) {
      tokens.push({ kind: "name", name: name[0], at });
      at += name[0].length;
      continue;
    }
    // Typographic minus and multiplication signs read as their ASCII forms.
    const op = char === "−" ? "-" : char === "×" || char === "·" ? "*" : char;
    if ("+-*/^()".includes(op)) {
      tokens.push({ kind: "op", op, at });
      at++;
      continue;
    }
    throw new ExpressionError(`Unexpected “${char}”.`, at);
  }
  tokens.push({ kind: "end", at: source.length });
  return tokens;
}

/** Parses and compiles `source`. Throws an ExpressionError that points at the problem. */
export function compileExpression(
  source: string,
  constants: Readonly<Record<string, number>> = {},
): CompiledExpression {
  if (source.length > MAX_EXPRESSION_LENGTH)
    throw new ExpressionError(
      `Keep the expression under ${MAX_EXPRESSION_LENGTH} characters.`,
      MAX_EXPRESSION_LENGTH,
    );
  const known = { ...BASE_CONSTANTS, ...constants };
  const tokens = tokenize(source);
  const parameters: string[] = [];
  const used: Record<string, number> = {};
  let index = 0;

  const peek = () => tokens[index];
  const isOp = (op: string) => {
    const token = peek();
    return token.kind === "op" && token.op === op;
  };
  const expect = (op: string) => {
    if (!isOp(op))
      throw new ExpressionError(
        peek().kind === "end" ? `Missing “${op}”.` : `Expected “${op}”.`,
        peek().at,
      );
    index++;
  };

  const sum = (): Node => {
    let left = product();
    while (isOp("+") || isOp("-")) {
      const add = isOp("+");
      index++;
      const a = left;
      const b = product();
      left = add ? (x, p) => a(x, p) + b(x, p) : (x, p) => a(x, p) - b(x, p);
    }
    return left;
  };

  const product = (): Node => {
    let left = unary();
    while (isOp("*") || isOp("/")) {
      const times = isOp("*");
      index++;
      const a = left;
      const b = unary();
      left = times ? (x, p) => a(x, p) * b(x, p) : (x, p) => a(x, p) / b(x, p);
    }
    return left;
  };

  const unary = (): Node => {
    if (isOp("-")) {
      index++;
      const a = unary();
      return (x, p) => -a(x, p);
    }
    if (isOp("+")) {
      index++;
      return unary();
    }
    return power();
  };

  const power = (): Node => {
    const base = primary();
    if (!isOp("^")) return base;
    index++;
    const exponent = unary();
    return (x, p) => Math.pow(base(x, p), exponent(x, p));
  };

  const primary = (): Node => {
    const token = peek();
    if (token.kind === "number") {
      index++;
      const { value } = token;
      return () => value;
    }
    if (token.kind === "op" && token.op === "(") {
      index++;
      const inner = sum();
      expect(")");
      return inner;
    }
    if (token.kind === "name") {
      index++;
      const { name } = token;
      if (isOp("(")) {
        const fn = Object.hasOwn(FUNCTIONS, name) ? FUNCTIONS[name] : undefined;
        if (!fn)
          throw new ExpressionError(
            `Unknown function “${name}”. Use ${Object.keys(FUNCTIONS).join(", ")}.`,
            token.at,
          );
        index++;
        const argument = sum();
        expect(")");
        return (x, p) => fn(argument(x, p));
      }
      if (Object.hasOwn(FUNCTIONS, name))
        throw new ExpressionError(`“${name}” needs an argument.`, token.at);
      if (name === "x") return (x) => x;
      if (Object.hasOwn(known, name)) {
        const value = known[name];
        used[name] = value;
        return () => value;
      }
      let slot = parameters.indexOf(name);
      if (slot < 0) {
        if (parameters.length >= MAX_PARAMETERS)
          throw new ExpressionError(
            `Use at most ${MAX_PARAMETERS} parameters.`,
            token.at,
          );
        slot = parameters.push(name) - 1;
      }
      return (_x, p) => p[slot];
    }
    throw new ExpressionError(
      token.kind === "end"
        ? "The expression ends too early."
        : `Unexpected “${token.kind === "op" ? token.op : ""}”.`,
      token.at,
    );
  };

  if (tokens.length === 1)
    throw new ExpressionError("Enter an expression in x.", 0);
  const root = sum();
  if (peek().kind !== "end")
    throw new ExpressionError(
      isOp(")") ? "Unmatched “)”." : "Expected an operator.",
      peek().at,
    );
  return { source, parameters, constants: used, evaluate: root };
}
