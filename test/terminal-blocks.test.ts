import { expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import { analyzeTerminalBlocks } from "../src/terminal-blocks.ts";

test("detects bordered terminal blocks with coordinates and text", async () => {
  const terminal = new Terminal({ cols: 40, rows: 12, allowProposedApi: true });
  await write(terminal, [
    "╭─ Inbox ─────────╮",
    "│ hello there     │",
    "│ second line     │",
    "╰─────────────────╯",
  ].join("\r\n"));

  const model = analyzeTerminalBlocks(terminal);

  expect(model.coordinateSystem).toMatchObject({ origin: "top-left", x1: "exclusive", y1: "exclusive" });
  expect(model.blocks[0]).toMatchObject({
    kind: "border-box",
    bounds: { x0: 0, y0: 0, x1: 19, y1: 4, width: 19, height: 4 },
    text: "hello there\nsecond line",
    border: { style: "single", title: "Inbox" },
  });
});

test("detects styled regions from xterm cell attributes", async () => {
  const terminal = new Terminal({ cols: 40, rows: 12, allowProposedApi: true });
  await write(terminal, "\x1b[44m selected row \x1b[0m\r\nplain row");

  const model = analyzeTerminalBlocks(terminal);

  expect(model.blocks).toEqual(expect.arrayContaining([
    expect.objectContaining({
      kind: "style-region",
      text: "selected row",
      colors: expect.objectContaining({ backgrounds: ["palette:4"] }),
    }),
  ]));
});

async function write(terminal: Terminal, chunk: string) {
  await new Promise<void>((resolve) => {
    terminal.write(chunk, () => resolve());
  });
}
