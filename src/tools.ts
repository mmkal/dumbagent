import {parseRequest, type ParsedRequest} from './api.ts'

export type FakeAgentFetch = (request: Request) => Response | Promise<Response>

export type SimulatedToolCommand = {
  type: 'readFile'
  args: [path: string]
}

export type SimulatedToolCall = {
  name: string
  args: Record<string, unknown>
}

export function parseSimulatedToolCommand(message: string): SimulatedToolCommand | null {
  const match = [...message.matchAll(/^\s*tool\s*:\s*(\[.+?\])\s*$/gim)].at(-1)
  if (!match) {
    return null
  }

  let tuple: unknown
  try {
    tuple = JSON.parse(match[1])
  } catch {
    return null
  }

  if (!Array.isArray(tuple) || tuple[0] !== 'readFile' || typeof tuple[1] !== 'string' || !tuple[1].trim()) {
    return null
  }

  return {type: 'readFile', args: [tuple[1].trim()]}
}

export function simulateToolCall(parsed: ParsedRequest, command: SimulatedToolCommand): Response {
  const toolCall = readFileToolCall(parsed, command.args[0])
  return parsed.respond.toolCall(toolCall.name, toolCall.args)
}

export function withSimulatedToolCalls(fetch: FakeAgentFetch): FakeAgentFetch {
  return async (request) => {
    const parsed = await parseRequest(request.clone())
    const toolResult = extractToolResult(parsed)
    if (toolResult) {
      return parsed.respond.text(toolResult)
    }

    const command = parseSimulatedToolCommand(parsed.lastMessage)
    if (command) {
      return simulateToolCall(parsed, command)
    }
    return fetch(request)
  }
}

export function readFileToolCall(parsed: ParsedRequest, path: string): SimulatedToolCall {
  if (parsed.anthropic) {
    return {name: 'Read', args: {file_path: path}}
  }

  if (parsed.codex) {
    return {name: 'shell', args: {command: ['cat', path]}}
  }

  return {name: 'read', args: {filePath: path}}
}

export function extractToolResult(parsed: ParsedRequest): string | null {
  if (parsed.anthropic) {
    const messages = Array.isArray(parsed.body.messages) ? parsed.body.messages : []
    for (let i = messages.length - 1; i >= 0; i--) {
      const toolResult = messages[i].content.find?.((item: any) => item.type === 'tool_result')
      if (toolResult) {
        return extractToolContent(toolResult.content)
      }
    }
    return null
  }

  if (parsed.codex) {
    const toolResult = findLast(parsed.body.input, (item: any) => item.type === 'function_call_output')
    return toolResult ? extractToolContent(toolResult.output) : null
  }

  const toolMessage = findLast(parsed.body.messages, (message: any) => message.role === 'tool')
  return toolMessage ? extractToolContent(toolMessage.content) : null
}

function findLast<T>(items: T[] | undefined, predicate: (item: T) => boolean) {
  if (!Array.isArray(items)) {
    return null
  }

  for (let i = items.length - 1; i >= 0; i--) {
    if (predicate(items[i])) {
      return items[i]
    }
  }
  return null
}

function extractToolContent(content: any): string {
  return JSON.stringify({ toolResult: content }, null, 2)
}
