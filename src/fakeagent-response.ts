export function formatFakeAgentFallback(text: string) {
  if (!text) {
    return "fakeagent ready";
  }
  return `"${spongebobCase(text.slice(0, 50))}" do you hear yourself`;
}

function spongebobCase(text: string) {
  let state = 0x811c9dc5;
  let result = "";
  for (const char of text) {
    state = Math.imul(state ^ char.codePointAt(0)!, 0x01000193);
    if (!/[a-z]/i.test(char)) {
      result += char;
      continue;
    }
    result += state & 1 ? char.toUpperCase() : char.toLowerCase();
  }
  return result;
}
