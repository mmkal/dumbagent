import {test, expect} from 'vitest'
import {elizaResponder, formatElizaResponse} from '../src/index.ts'

test('formats direct input with the ELIZA rules', () => {
  expect(formatElizaResponse('I need help')).toBe('Why do you need help?')
  expect(formatElizaResponse('I am extremely sad today')).toBe('Sorry to hear you are. Tell me about it.')
  expect(formatElizaResponse('')).toBe('Hello. How are you feeling today?')
})

test('reflects wildcard input into ELIZA responses', () => {
  expect(formatElizaResponse('Why can\'t I write tests')).toBe('Do you think you should be able to write tests?')
})

test('ELIZA responder returns the detected protocol response format', async () => {
  const response = await elizaResponder(new Request('http://localhost/v1/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      model: 'gpt',
      messages: [{role: 'user', content: 'I need help'}],
    }),
  }))

  expect(await response.json()).toMatchObject({
    choices: [{message: {role: 'assistant', content: 'Why do you need help?'}}],
  })
})
