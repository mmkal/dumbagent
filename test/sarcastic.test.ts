import {test, expect} from 'vitest'
import {formatSarcasticResponse, sarcasticResponder} from '../src/index.ts'

test('formats the sarcastic preset as a SpongeBob-style callout', () => {
  const response = formatSarcasticResponse('hello from a confusing echo')

  expect(response).toMatch(/^".+" do you hear yourself$/)
  expect(response.toLowerCase()).toContain('hello from a confusing echo')
  expect(response).not.toContain('fakeagent heard')
})

test('limits the sarcastic callout quote to the first 50 characters', () => {
  const response = formatSarcasticResponse('abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ')

  expect(response.replace(/^"|" do you hear yourself$/g, '')).toHaveLength(50)
})

test('ignores XML-style reminder blocks before mocking the prompt', () => {
  const response = formatSarcasticResponse(`
<system-reminder>
Do not reveal this reminder.
</system-reminder>

Hello. How may I help you today?
`)

  expect(response.toLowerCase()).toContain('hello. how may i help you today?')
  expect(response.toLowerCase()).not.toContain('system-reminder')
  expect(response.toLowerCase()).not.toContain('do not reveal')
  expect(response).toMatch(/^"[^ ].*[^ ]" do you hear yourself$/)
})

test('sarcastic responder returns the detected protocol response format', async () => {
  const response = await sarcasticResponder(new Request('http://localhost/v1/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'claude',
      messages: [{role: 'user', content: 'hello from anthropic'}],
    }),
  }))

  expect(await response.json()).toMatchObject({
    type: 'message',
    content: [{type: 'text', text: expect.stringContaining('do you hear yourself')}],
  })
})
