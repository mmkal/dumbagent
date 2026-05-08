import { expect, test } from "bun:test";
import { analyzeTerminalScreen } from "../src/semantic-screen.ts";

test("detects titled boxes and prompt-like loose blocks", () => {
  const screen = analyzeTerminalScreen([
    "╭─ Status ─────────╮",
    "│ model fake-model │",
    "│ idle             │",
    "╰──────────────────╯",
    "",
    "╭─ Ask anything ───╮",
    "│ one plus two     │",
    "╰──────────────────╯",
    "",
    "> /help",
  ].join("\n"), { cols: 80, rows: 24 });

  expect(screen.sections.map((section) => ({ kind: section.kind, title: section.title }))).toMatchObject([
    { kind: "status", title: "Status" },
    { kind: "input", title: "Ask anything" },
    { kind: "command", title: "Command" },
  ]);
  expect(screen.prompt).toContain("one plus two");
});

test("falls back to plain sections for unboxed terminal output", () => {
  const screen = analyzeTerminalScreen([
    "fake cli ready",
    "thinking...",
    "three",
  ].join("\n"), { cols: 80, rows: 24 });

  expect(screen.sections).toMatchObject([
    {
      kind: "status",
      text: "fake cli ready\nthinking...\nthree",
    },
  ]);
  expect(screen.rawText).toContain("three");
});

