import { expect, test } from "bun:test";
import { composerSubmitChunks } from "../src/terminal-input.ts";

test("submits OpenCode composer text with only a final enter", () => {
  expect(composerSubmitChunks("opencode", "hello\n")).toEqual(["hello", "\r"]);
});

test("keeps Codex composer submit on the LF then CR path", () => {
  expect(composerSubmitChunks("codex", "hello\n")).toEqual(["hello", "\n", "\r"]);
});

test("normalizes normal command composer submits to carriage returns", () => {
  expect(composerSubmitChunks("node", "one\ntwo\n")).toEqual(["one\rtwo\r"]);
});
