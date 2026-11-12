import { describe, expect, it } from "vitest";
import {
  compileExpression,
  ExpressionError,
  MAX_EXPRESSION_LENGTH,
} from "./expression";

const value = (
  source: string,
  x = 0,
  p: number[] = [],
  constants: Record<string, number> = {},
) => compileExpression(source, constants).evaluate(x, p);

describe("fit expressions", () => {
  it("follows the usual precedence", () => {
    expect(value("1 + 2*3")).toBe(7);
    expect(value("(1 + 2)*3")).toBe(9);
    expect(value("8 / 4 / 2")).toBe(1);
    expect(value("2^3^2")).toBe(512);
    expect(value("-2^2")).toBe(-4);
    expect(value("2^-1")).toBe(0.5);
    expect(value("10 - 4 - 3")).toBe(3);
    expect(value("+x", 5)).toBe(5);
  });

  it("reads numbers, functions and constants", () => {
    expect(value("1.5e3 + .5")).toBe(1500.5);
    expect(value("sin(90*deg)")).toBeCloseTo(1, 15);
    expect(value("sqrt(abs(-16)) + log(exp(2))")).toBeCloseTo(6, 12);
    expect(value("cos(pi) + tan(0)")).toBe(-1);
    expect(value("g*2", 0, [], { g: 9.81 })).toBe(19.62);
  });

  it("accepts typographic operators", () => {
    expect(value("3 × 2 − 1")).toBe(5);
    expect(value("3·x", 2)).toBe(6);
  });

  it("collects parameters in order of first appearance", () => {
    const compiled = compileExpression("b*x + a + b", { g: 9.81 });
    expect(compiled.parameters).toEqual(["b", "a"]);
    expect(compiled.evaluate(2, [3, 1])).toBe(10);
    expect(compiled.constants).toEqual({});
    const incline = compileExpression("g*(sin(x*deg) - mu*cos(x*deg))", {
      g: 9.81,
    });
    expect(incline.parameters).toEqual(["mu"]);
    expect(incline.constants).toEqual({ g: 9.81, deg: Math.PI / 180 });
  });

  it("points at the problem in bad input", () => {
    const failure = (source: string) => {
      try {
        compileExpression(source);
      } catch (error) {
        expect(error).toBeInstanceOf(ExpressionError);
        return error as ExpressionError;
      }
      throw new Error(`"${source}" compiled`);
    };
    expect(failure("")).toMatchObject({ position: 0 });
    expect(failure("2x")).toMatchObject({
      message: "Expected an operator.",
      position: 1,
    });
    expect(failure("(1 + 2")).toMatchObject({ message: "Missing “)”." });
    expect(failure("1 + 2)")).toMatchObject({ message: "Unmatched “)”." });
    expect(failure("1 +")).toMatchObject({
      message: "The expression ends too early.",
    });
    expect(failure("a $ b")).toMatchObject({ position: 2 });
    expect(failure("foo(x)").message).toMatch(/Unknown function “foo”/);
    expect(failure("sin + 1").message).toMatch(/needs an argument/);
    expect(failure("a+b+c+d+e+f+h").message).toMatch(/at most 6/);
    expect(failure("1+".repeat(MAX_EXPRESSION_LENGTH)).message).toMatch(
      /under/,
    );
  });

  it("never reaches the global scope", () => {
    expect(compileExpression("constructor").parameters).toEqual([
      "constructor",
    ]);
    expect(() => compileExpression("alert(1)")).toThrow(/Unknown function/);
    expect(() => compileExpression("x; 1")).toThrow(ExpressionError);
  });
});
