import type { Terminal as HeadlessTerminal } from "@xterm/headless";

type TuishotOptions = {
  title: string;
  fontSize: number;
  cellWidth: number;
  lineHeight: number;
  padding: number;
};

const defaultForeground = "#d6deeb";
const defaultBackground = "#0a0a0a";

const ansi16 = [
  "#2e3436",
  "#cc0000",
  "#4e9a06",
  "#c4a000",
  "#3465a4",
  "#75507b",
  "#06989a",
  "#d3d7cf",
  "#555753",
  "#ef2929",
  "#8ae234",
  "#fce94f",
  "#729fcf",
  "#ad7fa8",
  "#34e2e2",
  "#eeeeec",
];

export function renderTerminalShotSvg(terminal: HeadlessTerminal, options: TuishotOptions) {
  const buffer = terminal.buffer.active;
  const cols = terminal.cols;
  const rows = terminal.rows;
  const width = options.padding * 2 + cols * options.cellWidth;
  const height = options.padding * 2 + rows * options.lineHeight;
  const startY = buffer.viewportY;
  const backgroundRects: string[] = [];
  const textCells: string[] = [];
  const workCell = buffer.getNullCell();

  for (let row = 0; row < rows; row += 1) {
    const line = buffer.getLine(startY + row);
    if (!line) {
      continue;
    }
    let backgroundRun: { color: string; start: number; width: number } | null = null;
    let textRun: { style: ReturnType<typeof resolveCellStyle>; key: string; start: number; text: string } | null = null;
    for (let col = 0; col < cols; col += 1) {
      const cell = line.getCell(col, workCell);
      if (!cell || cell.getWidth() === 0) {
        continue;
      }
      const style = resolveCellStyle(cell);
      const cellWidth = Math.max(1, cell.getWidth());
      if (style.background !== defaultBackground) {
        if (backgroundRun && backgroundRun.color === style.background && backgroundRun.start + backgroundRun.width === col) {
          backgroundRun.width += cellWidth;
        } else {
          if (backgroundRun) {
            backgroundRects.push(renderBackground(row, backgroundRun, options));
          }
          backgroundRun = { color: style.background, start: col, width: cellWidth };
        }
      } else if (backgroundRun) {
        backgroundRects.push(renderBackground(row, backgroundRun, options));
        backgroundRun = null;
      }

      const chars = cell.isInvisible() ? " " : cell.getChars() || " ";
      const styleKey = textStyleKey(style);
      if (!chars.trim() && !textRun) {
        continue;
      }
      if (!textRun || textRun.key !== styleKey) {
        if (textRun) {
          textCells.push(renderTextRun(row, textRun, options));
        }
        if (!chars.trim()) {
          textRun = null;
          continue;
        }
        textRun = { style, key: styleKey, start: col, text: chars };
      } else {
        textRun.text += chars;
      }
    }
    if (backgroundRun) {
      backgroundRects.push(renderBackground(row, backgroundRun, options));
    }
    if (textRun) {
      textCells.push(renderTextRun(row, textRun, options));
    }
  }

  const cursor = renderCursor(buffer, startY, options);

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(options.title)}">`,
    `<title>${escapeXml(options.title)}</title>`,
    `<rect width="100%" height="100%" fill="${defaultBackground}"/>`,
    `<g font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="${options.fontSize}" text-rendering="geometricPrecision" shape-rendering="crispEdges">`,
    ...backgroundRects,
    ...textCells,
    cursor,
    `</g>`,
    `</svg>`,
    ``,
  ].join("\n");
}

function renderBackground(row: number, run: { color: string; start: number; width: number }, options: TuishotOptions) {
  const x = options.padding + run.start * options.cellWidth;
  const y = options.padding + row * options.lineHeight;
  return `<rect x="${x}" y="${y}" width="${run.width * options.cellWidth}" height="${options.lineHeight}" fill="${run.color}"/>`;
}

function renderTextRun(
  row: number,
  run: { style: ReturnType<typeof resolveCellStyle>; start: number; text: string },
  options: TuishotOptions,
) {
  const x = options.padding + run.start * options.cellWidth;
  const y = options.padding + row * options.lineHeight + options.fontSize;
  const style = run.style;
  const decorations = [
    style.bold ? `font-weight="700"` : "",
    style.italic ? `font-style="italic"` : "",
    style.underline ? `text-decoration="underline"` : "",
    style.dim ? `opacity="0.65"` : "",
  ].filter(Boolean).join(" ");
  return `<text x="${x}" y="${y}" fill="${style.foreground}" xml:space="preserve" ${decorations}>${escapeXml(run.text)}</text>`;
}

function renderCursor(
  buffer: HeadlessTerminal["buffer"]["active"],
  startY: number,
  options: TuishotOptions,
) {
  const row = buffer.baseY + buffer.cursorY - startY;
  if (row < 0) {
    return "";
  }
  const x = options.padding + buffer.cursorX * options.cellWidth;
  const y = options.padding + row * options.lineHeight;
  return `<rect x="${x}" y="${y}" width="${options.cellWidth}" height="${options.lineHeight}" fill="none" stroke="#f6e2b7" stroke-width="1"/>`;
}

function resolveCellStyle(cell: any) {
  let foreground = cell.isFgDefault() ? defaultForeground : colorFromCell(cell, "foreground");
  let background = cell.isBgDefault() ? defaultBackground : colorFromCell(cell, "background");
  if (cell.isInverse()) {
    const swapped = foreground;
    foreground = background;
    background = swapped;
  }
  return {
    foreground,
    background,
    bold: Boolean(cell.isBold()),
    italic: Boolean(cell.isItalic()),
    underline: Boolean(cell.isUnderline()),
    dim: Boolean(cell.isDim()),
  };
}

function textStyleKey(style: ReturnType<typeof resolveCellStyle>) {
  return [
    style.foreground,
    style.bold ? "b" : "",
    style.italic ? "i" : "",
    style.underline ? "u" : "",
    style.dim ? "d" : "",
  ].join("|");
}

function colorFromCell(cell: any, side: "foreground" | "background") {
  const color = side === "foreground" ? cell.getFgColor() : cell.getBgColor();
  const isRgb = side === "foreground" ? cell.isFgRGB() : cell.isBgRGB();
  if (isRgb) {
    return numberToHex(color);
  }
  return paletteColor(color);
}

function paletteColor(index: number) {
  if (index < ansi16.length) {
    return ansi16[index] || defaultForeground;
  }
  if (index >= 16 && index <= 231) {
    const offset = index - 16;
    const red = Math.floor(offset / 36);
    const green = Math.floor((offset % 36) / 6);
    const blue = offset % 6;
    return rgbToHex(cubeColor(red), cubeColor(green), cubeColor(blue));
  }
  if (index >= 232 && index <= 255) {
    const value = 8 + (index - 232) * 10;
    return rgbToHex(value, value, value);
  }
  return defaultForeground;
}

function cubeColor(value: number) {
  return value === 0 ? 0 : 55 + value * 40;
}

function numberToHex(value: number) {
  return `#${value.toString(16).padStart(6, "0").slice(-6)}`;
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${hexByte(red)}${hexByte(green)}${hexByte(blue)}`;
}

function hexByte(value: number) {
  return Math.max(0, Math.min(255, value)).toString(16).padStart(2, "0");
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
