import type { Terminal as HeadlessTerminal } from "@xterm/headless";

export type TerminalCell = {
  x: number;
  y: number;
  char: string;
  width: number;
  fg: string;
  bg: string;
  flags: string[];
  styleKey: string;
};

export type TerminalBlockKind = "border-box" | "style-region" | "text-block";
export type BorderStyle = "single" | "double" | "heavy" | "ascii" | "mixed";

export type TerminalBlock = {
  id: string;
  kind: TerminalBlockKind;
  bounds: Bounds;
  text: string;
  lines: string[];
  border: null | {
    style: BorderStyle;
    title: string;
  };
  colors: {
    foregrounds: string[];
    backgrounds: string[];
    flags: string[];
  };
  confidence: number;
};

export type TerminalBlockModel = {
  coordinateSystem: {
    origin: "top-left";
    x1: "exclusive";
    y1: "exclusive";
  };
  cols: number;
  rows: number;
  cursor: {
    x: number;
    y: number;
    visible: boolean;
  };
  rawText: string;
  blocks: TerminalBlock[];
};

type Bounds = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
  height: number;
};

type BoxCandidate = Bounds & {
  borderStyle: BorderStyle;
};

type TextRun = {
  x0: number;
  x1: number;
  y: number;
};

const topLeftCorners = new Set(["┌", "╭", "╔", "┏", "+"]);
const topRightCorners = new Set(["┐", "╮", "╗", "┓", "+"]);
const bottomLeftCorners = new Set(["└", "╰", "╚", "┗", "+"]);
const bottomRightCorners = new Set(["┘", "╯", "╝", "┛", "+"]);
const horizontalChars = new Set(["─", "═", "━", "╌", "╍", "┄", "┈", "-", "▀", "▄"]);
const verticalChars = new Set(["│", "║", "┃", "┆", "┊", "|"]);
const borderChars = new Set([
  ...topLeftCorners,
  ...topRightCorners,
  ...bottomLeftCorners,
  ...bottomRightCorners,
  ...horizontalChars,
  ...verticalChars,
  "╹",
  "╻",
  "╺",
  "╸",
]);

export function analyzeTerminalBlocks(terminal: HeadlessTerminal): TerminalBlockModel {
  const grid = readVisibleCells(terminal);
  const rawText = grid
    .map((row) => row.map((cell) => cell.char).join("").replace(/\s+$/g, ""))
    .join("\n")
    .trimEnd();
  const boxes = detectBorderBoxes(grid);
  const blocks = [
    ...boxes.map((box, index) => blockFromBorderBox(grid, box, index)),
    ...detectStyleRegions(grid, boxes),
    ...detectTextBlocks(grid, boxes),
  ]
    .filter((block) => block.text.trim())
    .sort((a, b) => (a.bounds.y0 - b.bounds.y0) || (a.bounds.x0 - b.bounds.x0) || blockKindOrder(a.kind) - blockKindOrder(b.kind));

  const start = Math.max(0, terminal.buffer.active.length - terminal.rows);
  return {
    coordinateSystem: {
      origin: "top-left",
      x1: "exclusive",
      y1: "exclusive",
    },
    cols: terminal.cols,
    rows: terminal.rows,
    cursor: {
      x: terminal.buffer.active.cursorX,
      y: terminal.buffer.active.baseY + terminal.buffer.active.cursorY - start,
      visible: true,
    },
    rawText,
    blocks,
  };
}

function readVisibleCells(terminal: HeadlessTerminal) {
  const buffer = terminal.buffer.active;
  const start = Math.max(0, buffer.length - terminal.rows);
  const rows: TerminalCell[][] = [];

  for (let rowIndex = 0; rowIndex < terminal.rows; rowIndex += 1) {
    const bufferLine = buffer.getLine(start + rowIndex);
    const row: TerminalCell[] = [];
    const reusableCell = buffer.getNullCell();
    for (let x = 0; x < terminal.cols; x += 1) {
      const cell = bufferLine?.getCell(x, reusableCell);
      const char = cell?.getChars() || " ";
      const width = cell?.getWidth() || 1;
      const flags = cell ? readFlags(cell) : [];
      const fg = cell ? readColor(cell, "fg") : "default";
      const bg = cell ? readColor(cell, "bg") : "default";
      row.push({
        x,
        y: rowIndex,
        char,
        width,
        fg,
        bg,
        flags,
        styleKey: `${fg}|${bg}|${flags.join(",")}`,
      });
    }
    rows.push(row);
  }

  return rows;
}

function readFlags(cell: any) {
  return [
    cell.isBold() ? "bold" : "",
    cell.isItalic() ? "italic" : "",
    cell.isDim() ? "dim" : "",
    cell.isUnderline() ? "underline" : "",
    cell.isBlink() ? "blink" : "",
    cell.isInverse() ? "inverse" : "",
    cell.isInvisible() ? "invisible" : "",
    cell.isStrikethrough() ? "strikethrough" : "",
    cell.isOverline() ? "overline" : "",
  ].filter(Boolean);
}

function readColor(cell: any, target: "fg" | "bg") {
  const isDefault = target === "fg" ? cell.isFgDefault() : cell.isBgDefault();
  if (isDefault) {
    return "default";
  }
  const isRgb = target === "fg" ? cell.isFgRGB() : cell.isBgRGB();
  const isPalette = target === "fg" ? cell.isFgPalette() : cell.isBgPalette();
  const value = target === "fg" ? cell.getFgColor() : cell.getBgColor();
  if (isRgb) {
    return `#${value.toString(16).padStart(6, "0")}`;
  }
  if (isPalette) {
    return `palette:${value}`;
  }
  return String(value);
}

function detectBorderBoxes(grid: TerminalCell[][]) {
  const boxes: BoxCandidate[] = [];
  for (let y = 0; y < grid.length; y += 1) {
    const row = grid[y] || [];
    for (let x = 0; x < row.length; x += 1) {
      if (!topLeftCorners.has(row[x]?.char || "")) {
        continue;
      }
      for (let x2 = x + 3; x2 < row.length; x2 += 1) {
        if (!topRightCorners.has(row[x2]?.char || "")) {
          continue;
        }
        if (horizontalBorderRatio(grid, y, x + 1, x2) < 0.52) {
          continue;
        }
        const box = findBottomBorder(grid, x, x2, y);
        if (box) {
          boxes.push(box);
        }
      }
    }
  }

  return dedupeBounds(boxes)
    .filter((box) => box.width >= 4 && box.height >= 3)
    .filter((box) => !boxes.some((other) => other !== box && other.x0 <= box.x0 && other.y0 <= box.y0 && other.x1 >= box.x1 && other.y1 >= box.y1 && area(other) > area(box)))
    .sort((a, b) => (a.y0 - b.y0) || (a.x0 - b.x0));
}

function findBottomBorder(grid: TerminalCell[][], x0: number, x2: number, y0: number): BoxCandidate | null {
  for (let y = y0 + 2; y < grid.length; y += 1) {
    const row = grid[y] || [];
    if (!bottomLeftCorners.has(row[x0]?.char || "") || !bottomRightCorners.has(row[x2]?.char || "")) {
      continue;
    }
    if (horizontalBorderRatio(grid, y, x0 + 1, x2) < 0.52) {
      continue;
    }
    if (verticalBorderRatio(grid, x0, x2, y0 + 1, y - 1) < 0.6) {
      continue;
    }
    return {
      x0,
      y0,
      x1: x2 + 1,
      y1: y + 1,
      width: x2 - x0 + 1,
      height: y - y0 + 1,
      borderStyle: inferBorderStyle(grid, { x0, y0, x1: x2 + 1, y1: y + 1 }),
    };
  }
  return null;
}

function horizontalBorderRatio(grid: TerminalCell[][], y: number, x0: number, x1: number) {
  let possible = 0;
  let found = 0;
  for (let x = x0; x < x1; x += 1) {
    const char = grid[y]?.[x]?.char || " ";
    if (char.trim()) {
      possible += 1;
      if (horizontalChars.has(char) || /[A-Za-z0-9 _./:-]/.test(char)) {
        found += horizontalChars.has(char) ? 1 : 0.15;
      }
    }
  }
  return possible ? found / possible : 1;
}

function verticalBorderRatio(grid: TerminalCell[][], x0: number, x1: number, y0: number, y1: number) {
  let possible = 0;
  let found = 0;
  for (let y = y0; y <= y1; y += 1) {
    possible += 2;
    if (verticalChars.has(grid[y]?.[x0]?.char || "")) {
      found += 1;
    }
    if (verticalChars.has(grid[y]?.[x1]?.char || "")) {
      found += 1;
    }
  }
  return possible ? found / possible : 0;
}

function inferBorderStyle(grid: TerminalCell[][], bounds: Pick<Bounds, "x0" | "y0" | "x1" | "y1">): BorderStyle {
  const chars = collectBorderChars(grid, bounds);
  if (chars.every((char) => "+-|".includes(char))) {
    return "ascii";
  }
  if (chars.some((char) => "╔╗╚╝║═".includes(char))) {
    return "double";
  }
  if (chars.some((char) => "┏┓┗┛┃━".includes(char))) {
    return "heavy";
  }
  if (chars.every((char) => "┌┐└┘╭╮╰╯│─".includes(char))) {
    return "single";
  }
  return "mixed";
}

function collectBorderChars(grid: TerminalCell[][], bounds: Pick<Bounds, "x0" | "y0" | "x1" | "y1">) {
  const chars: string[] = [];
  for (let x = bounds.x0; x < bounds.x1; x += 1) {
    chars.push(grid[bounds.y0]?.[x]?.char || " ");
    chars.push(grid[bounds.y1 - 1]?.[x]?.char || " ");
  }
  for (let y = bounds.y0 + 1; y < bounds.y1 - 1; y += 1) {
    chars.push(grid[y]?.[bounds.x0]?.char || " ");
    chars.push(grid[y]?.[bounds.x1 - 1]?.char || " ");
  }
  return chars.filter((char) => borderChars.has(char));
}

function blockFromBorderBox(grid: TerminalCell[][], box: BoxCandidate, index: number): TerminalBlock {
  const bounds = toBounds(box);
  const inner = {
    x0: box.x0 + 1,
    y0: box.y0 + 1,
    x1: box.x1 - 1,
    y1: box.y1 - 1,
  };
  const lines = extractLines(grid, inner);
  const title = extractBorderTitle(grid[box.y0]?.slice(box.x0 + 1, box.x1 - 1).map((cell) => cell.char).join("") || "");
  return {
    id: `border-${index + 1}`,
    kind: "border-box",
    bounds,
    text: cleanBlockText(lines),
    lines,
    border: {
      style: box.borderStyle,
      title,
    },
    colors: summarizeColors(grid, bounds),
    confidence: 0.9,
  };
}

function detectStyleRegions(grid: TerminalCell[][], boxes: Bounds[]) {
  const visited = new Set<string>();
  const blocks: TerminalBlock[] = [];
  for (const row of grid) {
    for (const cell of row) {
      if (visited.has(cellKey(cell)) || isInsideAny(cell.x, cell.y, boxes) || !isStyledRegionCell(cell)) {
        continue;
      }
      const region = floodStyleRegion(grid, cell, visited);
      if (region.cells.length < 2) {
        continue;
      }
      const bounds = boundsForCells(region.cells);
      const lines = extractLines(grid, bounds);
      blocks.push({
        id: `style-${blocks.length + 1}`,
        kind: "style-region",
        bounds,
        text: cleanBlockText(lines),
        lines,
        border: null,
        colors: summarizeColors(grid, bounds),
        confidence: 0.72,
      });
    }
  }
  return blocks;
}

function isStyledRegionCell(cell: TerminalCell) {
  return cell.bg !== "default" || cell.flags.includes("inverse");
}

function floodStyleRegion(grid: TerminalCell[][], start: TerminalCell, visited: Set<string>) {
  const queue = [start];
  const cells: TerminalCell[] = [];
  visited.add(cellKey(start));
  while (queue.length) {
    const cell = queue.shift()!;
    cells.push(cell);
    for (const next of neighbors(grid, cell)) {
      if (visited.has(cellKey(next))) {
        continue;
      }
      if (next.bg !== start.bg || next.flags.includes("inverse") !== start.flags.includes("inverse")) {
        continue;
      }
      visited.add(cellKey(next));
      queue.push(next);
    }
  }
  return { cells };
}

function neighbors(grid: TerminalCell[][], cell: TerminalCell) {
  return [
    grid[cell.y - 1]?.[cell.x],
    grid[cell.y + 1]?.[cell.x],
    grid[cell.y]?.[cell.x - 1],
    grid[cell.y]?.[cell.x + 1],
  ].filter((candidate): candidate is TerminalCell => Boolean(candidate));
}

function detectTextBlocks(grid: TerminalCell[][], boxes: Bounds[]) {
  const runs = collectTextRuns(grid, boxes);
  const groups: TextRun[][] = [];

  for (const run of runs) {
    const group = groups.find((candidate) => {
      const previous = candidate[candidate.length - 1]!;
      return run.y === previous.y + 1 && intervalsTouch(run, previous);
    });
    if (group) {
      group.push(run);
    } else {
      groups.push([run]);
    }
  }

  return groups.map((group, index): TerminalBlock => {
    const bounds = boundsForRuns(group);
    const lines = extractLines(grid, bounds);
    return {
      id: `text-${index + 1}`,
      kind: "text-block",
      bounds,
      text: cleanBlockText(lines),
      lines,
      border: null,
      colors: summarizeColors(grid, bounds),
      confidence: 0.62,
    };
  });
}

function collectTextRuns(grid: TerminalCell[][], boxes: Bounds[]) {
  const runs: TextRun[] = [];
  for (const row of grid) {
    let x = 0;
    while (x < row.length) {
      while (x < row.length && !isTextContentCell(row[x]!, boxes)) {
        x += 1;
      }
      const start = x;
      while (x < row.length && isTextContentCell(row[x]!, boxes)) {
        x += 1;
      }
      if (x > start) {
        runs.push({ x0: start, x1: x, y: row[0]?.y || 0 });
      }
    }
  }
  return runs;
}

function isTextContentCell(cell: TerminalCell, boxes: Bounds[]) {
  if (isInsideAny(cell.x, cell.y, boxes)) {
    return false;
  }
  if (!cell.char.trim()) {
    return false;
  }
  return !borderChars.has(cell.char) || /[A-Za-z0-9]/.test(cell.char);
}

function intervalsTouch(a: TextRun, b: TextRun) {
  return a.x0 <= b.x1 + 2 && b.x0 <= a.x1 + 2;
}

function extractLines(grid: TerminalCell[][], bounds: Pick<Bounds, "x0" | "y0" | "x1" | "y1">) {
  const lines: string[] = [];
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    lines.push((grid[y] || []).slice(bounds.x0, bounds.x1).map((cell) => cell.char).join("").replace(/\s+$/g, ""));
  }
  while (lines.length && !lines[0]!.trim()) {
    lines.shift();
  }
  while (lines.length && !lines[lines.length - 1]!.trim()) {
    lines.pop();
  }
  return lines;
}

function extractBorderTitle(text: string) {
  return text
    .replace(/[─═━╌╍┄┈_=]+|--+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanBlockText(lines: string[]) {
  return lines.map((line) => line.trim()).filter(Boolean).join("\n");
}

function summarizeColors(grid: TerminalCell[][], bounds: Pick<Bounds, "x0" | "y0" | "x1" | "y1">) {
  const foregrounds = new Set<string>();
  const backgrounds = new Set<string>();
  const flags = new Set<string>();
  for (let y = bounds.y0; y < bounds.y1; y += 1) {
    for (let x = bounds.x0; x < bounds.x1; x += 1) {
      const cell = grid[y]?.[x];
      if (!cell) {
        continue;
      }
      if (cell.fg !== "default") {
        foregrounds.add(cell.fg);
      }
      if (cell.bg !== "default") {
        backgrounds.add(cell.bg);
      }
      for (const flag of cell.flags) {
        flags.add(flag);
      }
    }
  }
  return {
    foregrounds: [...foregrounds].sort(),
    backgrounds: [...backgrounds].sort(),
    flags: [...flags].sort(),
  };
}

function boundsForCells(cells: TerminalCell[]): Bounds {
  const x0 = Math.min(...cells.map((cell) => cell.x));
  const y0 = Math.min(...cells.map((cell) => cell.y));
  const x1 = Math.max(...cells.map((cell) => cell.x)) + 1;
  const y1 = Math.max(...cells.map((cell) => cell.y)) + 1;
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

function boundsForRuns(runs: TextRun[]): Bounds {
  const x0 = Math.min(...runs.map((run) => run.x0));
  const y0 = Math.min(...runs.map((run) => run.y));
  const x1 = Math.max(...runs.map((run) => run.x1));
  const y1 = Math.max(...runs.map((run) => run.y)) + 1;
  return { x0, y0, x1, y1, width: x1 - x0, height: y1 - y0 };
}

function dedupeBounds<T extends Bounds>(items: T[]) {
  const byKey = new Map<string, T>();
  for (const item of items) {
    byKey.set(`${item.x0}:${item.y0}:${item.x1}:${item.y1}`, item);
  }
  return [...byKey.values()];
}

function isInsideAny(x: number, y: number, bounds: Bounds[]) {
  return bounds.some((bound) => x >= bound.x0 && x < bound.x1 && y >= bound.y0 && y < bound.y1);
}

function cellKey(cell: TerminalCell) {
  return `${cell.x}:${cell.y}`;
}

function area(bounds: Pick<Bounds, "width" | "height">) {
  return bounds.width * bounds.height;
}

function toBounds(bounds: Bounds): Bounds {
  return {
    x0: bounds.x0,
    y0: bounds.y0,
    x1: bounds.x1,
    y1: bounds.y1,
    width: bounds.width,
    height: bounds.height,
  };
}

function blockKindOrder(kind: TerminalBlockKind) {
  if (kind === "border-box") {
    return 0;
  }
  if (kind === "style-region") {
    return 1;
  }
  return 2;
}
