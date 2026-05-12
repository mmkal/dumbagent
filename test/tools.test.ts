import {test, expect} from 'vitest'
import {parseRequest, withSimulatedToolCalls} from '../src/index.ts'

test('simulates an opencode/OpenAI read file tool call', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'fake-model',
      messages: [{role: 'user', content: 'tool:["readFile","src/index.ts"]'}],
    }),
  }))

  expect(await response.json()).toMatchObject({
    choices: [{
      message: {
        tool_calls: [{
          type: 'function',
          function: {name: 'read', arguments: '{"filePath":"src/index.ts"}'},
        }],
      },
      finish_reason: 'tool_calls',
    }],
  })
})

test('accepts tool command casing and whitespace variations', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'fake-model',
      messages: [{role: 'user', content: ' Tool : ["readFile", "src/index.ts"] '}],
    }),
  }))

  expect(await response.json()).toMatchObject({
    choices: [{
      message: {
        tool_calls: [{
          function: {name: 'read', arguments: '{"filePath":"src/index.ts"}'},
        }],
      },
    }],
  })
})

test('finds tool command after injected reminder text', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'claude',
      messages: [{
        role: 'user',
        content: [
          {type: 'text', text: '<system-reminder>ignore me</system-reminder>\n\n'},
          {type: 'text', text: 'tool:["readFile","src/index.ts"]'},
        ],
      }],
    }),
  }))

  expect(await response.json()).toMatchObject({
    content: [{type: 'tool_use', name: 'Read', input: {file_path: 'src/index.ts'}}],
  })
})

test('simulates a Claude read file tool call', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'claude',
      messages: [{role: 'user', content: 'tool:["readFile","src/api.ts"]'}],
    }),
  }))

  expect(await response.json()).toMatchObject({
    content: [{type: 'tool_use', name: 'Read', input: {file_path: 'src/api.ts'}}],
    stop_reason: 'tool_use',
  })
})

test('simulates a Codex read file tool call through shell', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'gpt',
      input: [{role: 'user', content: 'tool:["readFile","test/eliza.test.ts"]'}],
    }),
  }))

  expect(await response.json()).toMatchObject({
    output: [{
      type: 'function_call',
      name: 'shell',
      arguments: '{"command":["cat","test/eliza.test.ts"]}',
    }],
  })
})

test('delegates to wrapped fetch when no simulated tool syntax is present', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'claude',
      messages: [{role: 'user', content: 'hello'}],
    }),
  }))

  expect(await response.json()).toMatchObject({
    content: [{type: 'text', text: 'fallback: hello'}],
  })
})

test('returns opencode/OpenAI tool result content instead of repeating the tool call', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'fake-model',
      messages: [
        {role: 'user', content: 'tool:["readFile","src/index.ts"]'},
        {role: 'assistant', tool_calls: [{id: 'call_1', type: 'function', function: {name: 'read', arguments: '{"filePath":"src/index.ts"}'}}]},
        {role: 'tool', tool_call_id: 'call_1', content: 'export const ok = true'},
      ],
    }),
  }))

  expect(await response.json()).toMatchObject({
    choices: [{message: {role: 'assistant', content: toolResult('export const ok = true')}}],
  })
})

test('returns Claude tool result content instead of repeating the tool call', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'claude',
      messages: [
        {role: 'user', content: 'tool:["readFile","src/index.ts"]'},
        {role: 'assistant', content: [{type: 'tool_use', id: 'tool_1', name: 'Read', input: {file_path: 'src/index.ts'}}]},
        {role: 'user', content: [{type: 'tool_result', tool_use_id: 'tool_1', content: 'export const ok = true'}]},
      ],
    }),
  }))

  expect(await response.json()).toMatchObject({
    content: [{type: 'text', text: toolResult('export const ok = true')}],
  })
})

test('returns Codex function output instead of repeating the tool call', async () => {
  const response = await simulatedToolResponse(new Request('http://localhost/v1/responses', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'gpt',
      input: [
        {role: 'user', content: 'tool:["readFile","src/index.ts"]'},
        {type: 'function_call_output', call_id: 'call_1', output: 'export const ok = true'},
      ],
    }),
  }))

  expect(await response.json()).toMatchObject({
    output: [{
      type: 'message',
      role: 'assistant',
      content: [{type: 'output_text', text: toolResult('export const ok = true')}],
    }],
  })
})

function toolResult(content: string) {
  return JSON.stringify({toolResult: content}, null, 2)
}

async function simulatedToolResponse(request: Request) {
  const fetch = withSimulatedToolCalls(async (fallbackRequest) => {
    const parsed = await parseRequest(fallbackRequest)
    return parsed.respond.text(`fallback: ${parsed.lastMessage}`)
  })

  return fetch(request)
}
