import { expect, test } from "bun:test";
import { createSessionId } from "../src/session-id.ts";

test("creates TUI UI session ids with a prefix and no hyphens", () => {
  expect(createSessionId()).toMatch(/^tuiui_[a-f0-9]{32}$/);
});
