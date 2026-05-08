export type ScreenSectionKind =
  | "box"
  | "input"
  | "prompt"
  | "status"
  | "tool"
  | "command"
  | "list"
  | "message"
  | "plain";

export type ScreenSection = {
  id: string;
  kind: ScreenSectionKind;
  title: string;
  text: string;
  lines: string[];
  confidence: number;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type SemanticScreen = {
  title: string;
  status: string;
  prompt: string;
  rawText: string;
  sections: ScreenSection[];
};

export type AnalyzeTerminalScreenOptions = {
  cols: number;
  rows: number;
};

type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const topLeftCorners = new Set(["┌", "╭", "╔", "╒", "╓", "+"]);
const topRightCorners = new Set(["┐", "╮", "╗", "╕", "╖", "+"]);
const bottomLeftCorners = new Set(["└", "╰", "╚", "╘", "╙", "+"]);
const bottomRightCorners = new Set(["┘", "╯", "╝", "╛", "╜", "+"]);
const horizontalChars = new Set(["─", "═", "━", "╌", "╍", "┄", "┈", "-"]);
const verticalChars = new Set(["│", "║", "|"]);

export function analyzeTerminalScreen(rawText: string, options: AnalyzeTerminalScreenOptions): SemanticScreen {
  const visibleLines = normalizeLines(rawText, options.rows);
  const boxes = detectBoxes(visibleLines);
  const sections = [
    ...boxes.map((box, index) => sectionFromBox(visibleLines, box, index)),
    ...sectionsFromLooseBlocks(visibleLines, boxes),
  ]
    .filter((section) => section.text.trim())
    .sort((a, b) => (a.bounds.y - b.bounds.y) || (a.bounds.x - b.bounds.x));

  const title = pickTitle(sections, rawText);
  const status = pickFirstText(sections, ["status"]) || "";
  const prompt = pickFirstText(sections, ["input", "prompt"]) || "";

  return {
    title,
    status,
    prompt,
    rawText: visibleLines.join("\n").trimEnd(),
    sections,
  };
}

function normalizeLines(rawText: string, rows: number) {
  const normalized = rawText.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  const lines = normalized.split("\n").map((line) => line.replace(/\s+$/g, ""));
  const start = Math.max(0, lines.length - rows);
  return lines.slice(start);
}

function detectBoxes(lines: string[]) {
  const boxes: Box[] = [];

  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y] || "";
    for (let x = 0; x < line.length; x += 1) {
      if (!topLeftCorners.has(line[x] || "")) {
        continue;
      }
      const right = findTopRight(line, x + 3);
      for (const x2 of right) {
        const box = findMatchingBottom(lines, x, x2, y);
        if (box) {
          boxes.push(box);
        }
      }
    }
  }

  return dedupeBoxes(boxes)
    .filter((box) => box.width >= 4 && box.height >= 3)
    .filter((box) => !isMostlyDuplicatedByLargerBox(box, boxes))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x) || (b.width * b.height - a.width * a.height));
}

function findTopRight(line: string, minX: number) {
  const matches: number[] = [];
  for (let x = minX; x < line.length; x += 1) {
    if (!topRightCorners.has(line[x] || "")) {
      continue;
    }
    const segment = line.slice(minX - 2, x);
    if (borderishRatio(segment) >= 0.12) {
      matches.push(x);
    }
  }
  return matches;
}

function findMatchingBottom(lines: string[], x1: number, x2: number, topY: number): Box | null {
  for (let y = topY + 2; y < lines.length; y += 1) {
    const line = lines[y] || "";
    if (!bottomLeftCorners.has(line[x1] || "") || !bottomRightCorners.has(line[x2] || "")) {
      continue;
    }
    if (borderishRatio(line.slice(x1 + 1, x2)) < 0.42) {
      continue;
    }
    if (verticalRatio(lines, x1, x2, topY + 1, y - 1) < 0.58) {
      continue;
    }
    return { x: x1, y: topY, width: x2 - x1 + 1, height: y - topY + 1 };
  }
  return null;
}

function borderishRatio(segment: string) {
  const chars = [...segment].filter((char) => char.trim() !== "");
  if (chars.length === 0) {
    return 1;
  }
  const borderish = chars.filter((char) => horizontalChars.has(char) || char === "=" || char === "_").length;
  return borderish / chars.length;
}

function verticalRatio(lines: string[], x1: number, x2: number, startY: number, endY: number) {
  let possible = 0;
  let found = 0;
  for (let y = startY; y <= endY; y += 1) {
    possible += 2;
    const line = lines[y] || "";
    if (verticalChars.has(line[x1] || "")) {
      found += 1;
    }
    if (verticalChars.has(line[x2] || "")) {
      found += 1;
    }
  }
  return possible > 0 ? found / possible : 0;
}

function dedupeBoxes(boxes: Box[]) {
  const byKey = new Map<string, Box>();
  for (const box of boxes) {
    byKey.set(`${box.x}:${box.y}:${box.width}:${box.height}`, box);
  }
  return [...byKey.values()];
}

function isMostlyDuplicatedByLargerBox(box: Box, allBoxes: Box[]) {
  return allBoxes.some((other) => {
    if (other === box) {
      return false;
    }
    if (other.x !== box.x || other.y !== box.y) {
      return false;
    }
    return other.width > box.width && other.height >= box.height;
  });
}

function sectionFromBox(lines: string[], box: Box, index: number): ScreenSection {
  const topLine = lines[box.y] || "";
  const contentLines = lines
    .slice(box.y + 1, box.y + box.height - 1)
    .map((line) => line.slice(box.x + 1, box.x + box.width - 1).replace(/\s+$/g, ""));
  const text = contentLines.map((line) => line.trim()).filter(Boolean).join("\n");
  const title = titleFromBorder(topLine.slice(box.x + 1, box.x + box.width - 1)) || firstUsefulLine(contentLines) || "Section";
  const kind = inferKind(title, text, true);

  return {
    id: `box-${index + 1}`,
    kind,
    title,
    text,
    lines: contentLines,
    confidence: 0.86,
    bounds: box,
  };
}

function titleFromBorder(segment: string) {
  return segment
    .replace(/[─═━╌╍┄┈_=]+|--+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstUsefulLine(lines: string[]) {
  const line = lines.map((candidate) => candidate.trim()).find((candidate) => candidate.length > 0);
  return line ? line.slice(0, 60) : "";
}

function sectionsFromLooseBlocks(lines: string[], boxes: Box[]) {
  const coveredRows = new Set<number>();
  for (const box of boxes) {
    for (let y = box.y; y < box.y + box.height; y += 1) {
      coveredRows.add(y);
    }
  }

  const sections: ScreenSection[] = [];
  let blockStart = -1;
  let blockLines: string[] = [];

  function flush() {
    if (blockStart === -1 || blockLines.length === 0) {
      blockStart = -1;
      blockLines = [];
      return;
    }
    const text = blockLines.map((line) => line.trim()).filter(Boolean).join("\n");
    const title = inferLooseTitle(text);
    sections.push({
      id: `block-${sections.length + 1}`,
      kind: inferKind(title, text, false),
      title,
      text,
      lines: blockLines,
      confidence: 0.58,
      bounds: {
        x: firstNonWhitespaceColumn(blockLines),
        y: blockStart,
        width: Math.max(...blockLines.map((line) => line.length), 1),
        height: blockLines.length,
      },
    });
    blockStart = -1;
    blockLines = [];
  }

  for (let y = 0; y < lines.length; y += 1) {
    const line = lines[y] || "";
    if (coveredRows.has(y) || !line.trim()) {
      flush();
      continue;
    }
    if (blockStart === -1) {
      blockStart = y;
    }
    blockLines.push(line);
  }
  flush();

  return sections;
}

function firstNonWhitespaceColumn(lines: string[]) {
  const indexes = lines
    .map((line) => line.search(/\S/))
    .filter((index) => index >= 0);
  return indexes.length ? Math.min(...indexes) : 0;
}

function inferLooseTitle(text: string) {
  const first = text.split("\n").find((line) => line.trim()) || "Output";
  if (/ask anything|prompt|input/i.test(text)) {
    return "Prompt";
  }
  if (/thinking|loading|running|idle|busy|tokens?|model/i.test(text)) {
    return "Status";
  }
  if (/^\s*[>$]\s+/.test(first)) {
    return "Command";
  }
  return first.trim().slice(0, 60) || "Output";
}

function inferKind(title: string, text: string, boxed: boolean): ScreenSectionKind {
  const combined = `${title}\n${text}`.toLowerCase();
  if (/ask anything|send message|compose|prompt|input/.test(combined)) {
    return boxed ? "input" : "prompt";
  }
  if (/thinking|loading|running|idle|busy|tokens?|model|cwd|connected|disconnected/.test(combined)) {
    return "status";
  }
  if (/^\s*[>$]\s+/m.test(text) || /^\s*\//m.test(text) || /^command$/i.test(title)) {
    return "command";
  }
  if (/tool|read|write|edit|patch|grep|bash|command|file|permission|diff|created|updated|deleted/.test(combined)) {
    return "tool";
  }
  const nonEmpty = text.split("\n").filter((line) => line.trim());
  const listItems = nonEmpty.filter((line) => /^\s*(?:[-*•]|\d+[.)])\s+/.test(line)).length;
  if (nonEmpty.length >= 2 && listItems / nonEmpty.length >= 0.55) {
    return "list";
  }
  if (boxed) {
    return "box";
  }
  return "plain";
}

function pickTitle(sections: ScreenSection[], rawText: string) {
  const nonStatus = sections.find((section) => section.kind !== "status" && section.title.trim());
  if (nonStatus) {
    return nonStatus.title;
  }
  const firstRawLine = rawText.split(/\r?\n/).find((line) => line.trim());
  return firstRawLine ? firstRawLine.trim().slice(0, 80) : "TUI session";
}

function pickFirstText(sections: ScreenSection[], kinds: ScreenSectionKind[]) {
  const section = sections.find((candidate) => kinds.includes(candidate.kind));
  return section ? section.text : "";
}
