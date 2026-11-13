import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { THEME_COLORS } from "../src/lib/theme.ts";

const indexHtml = readFileSync(
  new URL("../index.html", import.meta.url),
  "utf8"
);

test("app shell prevents referrer leakage for 302 video playback", () => {
  assert.match(
    indexHtml,
    /<meta\s+name="referrer"\s+content="no-referrer"\s*\/?>/
  );
});

test("app shell applies the saved theme without writing storage", () => {
  const dom = new JSDOM(indexHtml, {
    url: "http://localhost/",
    runScripts: "dangerously",
    beforeParse(window) {
      window.localStorage.setItem("video-site:theme", "light");
      window.Storage.prototype.setItem = () => { throw new Error("Storage quota exceeded"); };
    },
  });
  try {
    assert.equal(dom.window.document.documentElement.getAttribute("data-theme"), "light");
    assert.equal(dom.window.localStorage.getItem("video-site:theme"), "light");
    assert.equal(
      dom.window.document.querySelector('meta[name="theme-color"]')?.getAttribute("content"),
      THEME_COLORS.light
    );
  } finally {
    dom.window.close();
  }
});

test("retired light palettes restore as light before the app mounts", () => {
  for (const saved of ["pink", "sky"]) {
    const dom = new JSDOM(indexHtml, {
      url: "http://localhost/",
      runScripts: "dangerously",
      beforeParse(window) {
        window.localStorage.setItem("video-site:theme", saved);
      },
    });
    try {
      assert.equal(dom.window.document.documentElement.dataset.theme, "light");
    } finally {
      dom.window.close();
    }
  }
});

test("browser chrome colors match each theme's page background token", () => {
  const tokens = readFileSync(new URL("../src/styles/tokens.css", import.meta.url), "utf8");
  for (const theme of ["dark", "light"] as const) {
    const block = tokens.slice(tokens.indexOf(`:root[data-theme="${theme}"]`));
    const pageBackground = /--bg-page:\s*([^;]+);/.exec(block)?.[1].trim();
    assert.equal(THEME_COLORS[theme], pageBackground);
  }
});
