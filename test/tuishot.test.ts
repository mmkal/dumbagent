import { expect, test } from "bun:test";
import { Terminal } from "@xterm/headless";
import { renderTerminalShotSvg } from "../src/tuishot.ts";

test("renders the current terminal viewport as an SVG image", async () => {
  const terminal = new Terminal({ cols: 40, rows: 6, allowProposedApi: true });
  await writeTerminal(terminal, "plain\r\n\x1b[31mred\x1b[0m and box ╭─╮");

  const svg = renderTerminalShotSvg(terminal, {
    title: "test tuishot",
    fontSize: 12,
    cellWidth: 7.25,
    lineHeight: 14.2,
    padding: 10,
  });

  expect(svg).toContain("<svg");
  expect(svg).toContain("<title>test tuishot</title>");
  expect(svg).toContain("plain");
  expect(svg).toContain("red");
  expect(svg).toContain("box ╭─╮");
  expect(svg).toContain("fill=\"#cc0000\"");
});

async function writeTerminal(terminal: Terminal, chunk: string) {
  await new Promise<void>((resolve) => {
    terminal.write(chunk, () => resolve());
  });
}
