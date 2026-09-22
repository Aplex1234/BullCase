import assert from "node:assert/strict";
import test from "node:test";
import * as theme from "../hooks/useTerminalTheme.ts";

test("theme loading tolerates denied browser storage and invalid preferences", () => {
  assert.equal(theme.readSavedTheme(() => { throw new Error("SecurityError"); }), "dark");
  assert.equal(theme.readSavedTheme(() => ({ getItem: () => "invalid" })), "dark");
  assert.equal(theme.readSavedTheme(() => ({ getItem: () => "light" })), "light");
});

test("saving a theme tolerates full storage and preserves valid preferences", () => {
  assert.doesNotThrow(() => theme.persistTheme("light", () => { throw new Error("SecurityError"); }));
  assert.doesNotThrow(() => theme.persistTheme("light", () => ({ setItem: () => { throw new Error("QuotaExceededError"); } })));
  let stored;
  theme.persistTheme("light", () => ({ setItem: (key, value) => { stored = [key, value]; } }));
  assert.deepEqual(stored, ["aplex-theme-premium", "light"]);
});
