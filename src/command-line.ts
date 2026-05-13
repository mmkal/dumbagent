export type ParsedCommandLine = {
  command: string;
  args: string[];
};

export function parseCommandLine(input: string): ParsedCommandLine {
  const parts = parseArgs(input);
  return {
    command: parts[0] || "",
    args: parts.slice(1),
  };
}

export function parseArgs(input: string) {
  const args: string[] = [];
  let current = "";
  let quote = "";
  let escaped = false;

  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
      } else {
        current += char;
      }
      continue;
    }
    if (char === "'" || char === "\"") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (current) {
    args.push(current);
  }
  return args;
}

export function formatCommandLine(command: string, args: string[]) {
  return [command, ...args].map(quoteCommandPart).join(" ");
}

function quoteCommandPart(value: string) {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}
