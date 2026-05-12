import {parseRequest} from '../api.ts'

// Adapted from ../tuiui/src/fakeagent-response.ts.
// Kept local so the default CLI can run without depending on the TUI app.
export async function sarcasticResponder(request: Request): Promise<Response> {
  const parsed = await parseRequest(request)
  return parsed.respond.text(formatSarcasticResponse(parsed.lastMessage))
}

export function formatSarcasticResponse(text: string) {
  const cleanText = stripXmlBlocks(text).trim()
  if (!cleanText) {
    return 'fakeagent ready'
  }
  return `"${spongebobCase(cleanText.slice(0, 50))}" do you hear yourself`
}

function stripXmlBlocks(text: string) {
  let result = text
  let previous = ''
  while (result !== previous) {
    previous = result
    result = result.replace(/<([A-Za-z][\w:-]*)(?:\s[^>]*)?>[\s\S]*?<\/\1>/g, '')
  }
  return result.replace(/<\/?[A-Za-z][\w:-]*(?:\s[^>]*)?>/g, '')
}

function spongebobCase(text: string) {
  let state = 0x811c9dc5
  let result = ''
  for (const char of text) {
    state = Math.imul(state ^ char.codePointAt(0)!, 0x01000193)
    if (!/[a-z]/i.test(char)) {
      result += char
      continue
    }
    result += state & 1 ? char.toUpperCase() : char.toLowerCase()
  }
  return result
}
