import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const tokensCss = readFileSync(
  new URL("../src/styles/tokens.css", import.meta.url),
  "utf8",
);
const baseCss = readFileSync(
  new URL("../src/styles/base.css", import.meta.url),
  "utf8",
);

function requireRule(pattern: RegExp, source: string) {
  const match = source.match(pattern);
  assert.ok(match, `missing CSS rule: ${pattern}`);
  return match[1];
}

test("dark and light page backgrounds do not use localized color glows", () => {
  const baseBackground = requireRule(/\nbody::before\s*\{([^}]*)\}/s, baseCss);
  const darkBackground = requireRule(
    /:root body::before,\s*:root\[data-theme="dark"\] body::before\s*\{([^}]*)\}/s,
    tokensCss,
  );
  const lightBackground = requireRule(
    /:root\[data-theme="light"\] body::before\s*\{([^}]*)\}/s,
    tokensCss,
  );

  assert.doesNotMatch(baseBackground, /(?:radial-gradient|linear-gradient)/);
  assert.doesNotMatch(darkBackground, /radial-gradient/);
  assert.doesNotMatch(lightBackground, /radial-gradient/);
  assert.match(darkBackground, /linear-gradient\(to right/);
  assert.match(lightBackground, /linear-gradient\(to right/);
});
