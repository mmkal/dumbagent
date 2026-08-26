// Protocol helpers: parse common LLM API requests and build matching responses.
// Dependency-free (no node:http, no ws) so preset responders and test-side
// consumers can import them without the fake server.

export const responses = {
  openai: {
    text(content: string): Response {
      return Response.json({
        id: `chatcmpl-fake-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'fake-model',
        choices: [{index: 0, message: {role: 'assistant', content}, finish_reason: 'stop'}],
        usage: {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0},
      })
    },
    toolCall(name: string, args: Record<string, unknown>, callId = `call_fake_${Date.now()}`): Response {
      return Response.json({
        id: `chatcmpl-fake-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: 'fake-model',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            tool_calls: [{id: callId, type: 'function', function: {name, arguments: JSON.stringify(args)}}],
          },
          finish_reason: 'tool_calls',
        }],
        usage: {prompt_tokens: 0, completion_tokens: 0, total_tokens: 0},
      })
    },
  },
  anthropic: {
    text(content: string): Response {
      return Response.json({
        id: `msg_fake_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{type: 'text', text: content}],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {input_tokens: 0, output_tokens: 0},
      })
    },
    toolUse(name: string, input: Record<string, unknown>, toolUseId = `toolu_fake_${Date.now()}`): Response {
      return Response.json({
        id: `msg_fake_${Date.now()}`,
        type: 'message',
        role: 'assistant',
        content: [{type: 'tool_use', id: toolUseId, name, input}],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'tool_use',
        stop_sequence: null,
        usage: {input_tokens: 0, output_tokens: 0},
      })
    },
  },
  codex: {
    text(content: string): Response {
      const id = `resp_fake_${Date.now()}`
      const msgId = `msg_fake_${Date.now()}`
      return Response.json({
        id,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        model: 'fake-model',
        status: 'completed',
        output: [{
          type: 'message',
          role: 'assistant',
          id: msgId,
          content: [{type: 'output_text', text: content}],
        }],
        usage: {input_tokens: 0, output_tokens: 0, total_tokens: 0},
        error: null,
        incomplete_details: null,
      })
    },
    functionCall(name: string, args: Record<string, unknown>, callId = `call_fake_${Date.now()}`): Response {
      const id = `resp_fake_${Date.now()}`
      return Response.json({
        id,
        object: 'response',
        created_at: Math.floor(Date.now() / 1000),
        model: 'fake-model',
        status: 'completed',
        output: [{
          id: `item_fake_${Date.now()}`,
          type: 'function_call',
          call_id: callId,
          name,
          arguments: JSON.stringify(args),
        }],
        usage: {input_tokens: 0, output_tokens: 0, total_tokens: 0},
        error: null,
        incomplete_details: null,
      })
    },
  },
}

export interface ParsedProtocol {
  lastMessage: string
}

export interface ParsedRequest {
  /** Non-null if this is an OpenAI chat completion request (/v1/chat/completions) */
  openai: ParsedProtocol | null
  /** Non-null if this is an Anthropic messages request (/v1/messages) */
  anthropic: ParsedProtocol | null
  /** Non-null if this is an OpenAI Responses API request (/v1/responses) */
  codex: ParsedProtocol | null
  /** Last user message from whichever protocol was detected */
  lastMessage: string
  /** System prompt / instructions text */
  systemPrompt: string
  /** Whether this request includes tool definitions */
  hasTools: boolean
  /** Return a response in the correct format for the detected protocol */
  respond: {
    text(content: string): Response
    toolCall(name: string, args: Record<string, unknown>): Response
  }
  /** The raw parsed body */
  body: any
}

function extractText(content: any): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === 'text' || b.type === 'input_text' || b.type === 'output_text')
      .map((b: any) => b.text)
      .join('\n')
  }
  return ''
}

/** Just a helper which does basic parsing of (some) common API requests and gives you a few helpers for matching and responding. You could trivially do this yourself though. */
export async function parseRequest(request: Request): Promise<ParsedRequest> {
  const text = await request.text()
  const body: any = text ? JSON.parse(text) : {}

  const path = new URL(request.url).pathname
  const isAnthropic = path.includes('/v1/messages')
  const isOpenAI = path.includes('/v1/chat/completions')
  const isCodex = path.includes('/v1/responses')

  // Codex uses `input` (string or array), OpenAI/Anthropic use `messages`
  const messages: Array<{role: string; content: any}> = isCodex
    ? (typeof body.input === 'string' ? [{role: 'user', content: body.input}] : body.input ?? [])
    : body.messages ?? []

  const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
  const lastMessage = lastUserMessage ? extractText(lastUserMessage.content) : ''

  const protocol: ParsedProtocol = {lastMessage}
  const proto = isAnthropic ? responses.anthropic : isCodex ? responses.codex : responses.openai
  const respond = {
    text: (content: string) => proto.text(content),
    toolCall: (name: string, args: Record<string, unknown>) =>
      isAnthropic ? responses.anthropic.toolUse(name, args)
        : isCodex ? responses.codex.functionCall(name, args)
        : responses.openai.toolCall(name, args),
  }

  // System prompt location differs by protocol
  const systemPrompt = isAnthropic ? extractText(body.system)
    : isCodex ? (body.instructions ?? '')
    : extractText(messages.filter((m) => m.role === 'system' || m.role === 'developer').map((m) => m.content).join('\n'))

  const hasTools = (body.tools?.length ?? 0) > 0

  return {
    openai: isOpenAI ? protocol : null,
    anthropic: isAnthropic ? protocol : null,
    codex: isCodex ? protocol : null,
    lastMessage,
    systemPrompt,
    hasTools,
    respond,
    body,
  }
}
