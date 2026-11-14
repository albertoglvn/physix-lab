import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import mark from "../assets/brand/physix-mark.png";
import { PhysixMark } from "./pastoral";

it("renders the new mark as a decorative square beside the wordmark", () => {
  const html = renderToStaticMarkup(<PhysixMark />);
  expect(html).toContain(
    `<img class="physix-mark" src="${mark}" width="24" height="24" alt=""/>`,
  );
});
