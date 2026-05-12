import {test, expect} from 'vitest'
import {ElizaBot, elizaResponder, formatElizaResponse} from '../src/index.ts'

test('formats direct input with the ELIZA rules', () => {
  expect(formatElizaResponse('I need help')).toBe('Why do you need help?')
  expect(formatElizaResponse('I am extremely sad today')).toBe('I am sorry to hear you are extremely sad today.')
  expect(formatElizaResponse('')).toBe('Hello. How are you feeling today?')
})

test('reflects wildcard input into ELIZA responses', () => {
  expect(formatElizaResponse('Why can\'t I write tests')).toBe('Do you think you should be able to write tests?')
})

test('rotates through broad "i am" responses instead of pinning sad to one answer', () => {
  const eliza = new ElizaBot()

  expect([
    eliza.respond('I am sad'),
    eliza.respond('I am sad'),
    eliza.respond('I am sad'),
    eliza.respond('I am sad'),
    eliza.respond('I am sad'),
  ]).toEqual([
    'I am sorry to hear you are sad.',
    'How long have you been sad?',
    'Do you believe it is normal to be sad?',
    'Do you enjoy being sad?',
    'Did you come to me because you are sad?',
  ])
})

test('continues rotating after a response list is exhausted', () => {
  const eliza = new ElizaBot()

  expect(Array.from({length: 8}, () => eliza.respond('I feel sad'))).toEqual([
    'Tell me more about such feelings.',
    'Do you often feel sad?',
    'Do you enjoy feeling sad?',
    'Why do you feel that way?',
    'Tell me more about such feelings.',
    'Do you often feel sad?',
    'Do you enjoy feeling sad?',
    'Why do you feel that way?',
  ])
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
