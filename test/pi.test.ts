import {test, expect} from 'vitest'
import {createDumbAgent, parseRequest} from '../src/index.ts'
import {waitForExit, spawnTui} from './helpers/index.ts'

test('pi print mode gets fake response', async () => {
  let capturedLastMessage = ''
  await using api = await createDumbAgent({
    async fetch(request) {
      const parsed = await parseRequest(request)
      capturedLastMessage = parsed.lastMessage
      return parsed.respond.text('three')
    },
  })

  const child = api.spawn('pi', ['-p', 'what is one plus two'], {
    cwd: '/tmp/dumbagent-test',
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 15_000)
  expect(exitCode, `stderr: ${stderr.slice(-500)}`).toBe(0)
  expect(stdout).toContain('three')
  expect(capturedLastMessage).toContain('what is one plus two')
}, 20_000)

test('pi TUI text response', async () => {
  await using api = await createDumbAgent({
    async fetch(request) {
      const parsed = await parseRequest(request)
      return parsed.respond.text('three')
    },
  })

  await using tui = await spawnTui(api, 'pi')
  await tui.waitFor('dumbagent')
  await tui.send('what is one plus two')
  await tui.waitFor('three', {timeout: 15_000})
}, 20_000)
