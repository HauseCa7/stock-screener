import { expect, it } from "vitest";
import { cleanText } from "./pdf";

it("strips characters the database can't store", () => {
  expect(cleanText("Revenue\u0000 $1,234\u0007")).toBe("Revenue  $1,234 ");
  expect(cleanText("bad \uD83D half")).toBe("bad  half");
  expect(cleanText("ok 😀 emoji\nnew line\ttab")).toBe("ok 😀 emoji\nnew line\ttab");
  expect(JSON.stringify(cleanText("a\u0000b"))).not.toContain("\\u0000");
});
