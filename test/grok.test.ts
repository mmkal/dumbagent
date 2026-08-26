import {writeFileSync, mkdirSync} from 'node:fs'
import {test, expect} from 'vitest'
import {createDumbAgent, parseRequest} from '../src/index.ts'
import {waitForExit, spawnTui} from './helpers/index.ts'

test('grok -p gets fake response', async () => {
  let capturedLastMessage = ''
  await using api = await createDumbAgent({
    async fetch(request) {
      const parsed = await parseRequest(request)
      capturedLastMessage = parsed.lastMessage
      return parsed.respond.text('three')
    },
  })

  const child = api.spawn('grok', ['-p', 'what is one plus two', '--output-format', 'json'], {
    cwd: '/tmp/dumbagent-test',
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 15_000)
  expect(exitCode, `stderr: ${stderr.slice(-500)}`).toBe(0)
  expect(JSON.parse(stdout).text).toContain('three')
  expect(capturedLastMessage).toContain('what is one plus two')
}, 20_000)

test('grok TUI text response', async () => {
  await using api = await createDumbAgent({
    async fetch(request) {
      const parsed = await parseRequest(request)
      return parsed.respond.text('three')
    },
  })

  await using tui = await spawnTui(api, 'grok')
  await tui.send('what is one plus two')
  await tui.waitFor('three', {timeout: 15_000})
}, 25_000)

test('grok TUI tool use', async () => {
  mkdirSync('/tmp/dumbagent-test', {recursive: true})
  writeFileSync('/tmp/dumbagent-test/hello.txt', 'hi')

  await using api = await createDumbAgent({
    async fetch(request) {
      const parsed = await parseRequest(request)
      const hasToolResult = parsed.body.messages?.some((m: any) => m.role === 'tool')
      if (hasToolResult) {
        return parsed.respond.text('the file says hi')
      }
      if (parsed.lastMessage.match(/read hello/)) {
        return parsed.respond.toolCall('read_file', {target_file: '/tmp/dumbagent-test/hello.txt'})
      }
      return parsed.respond.text('')
    },
  })

  await using tui = await spawnTui(api, 'grok')
  await tui.send('read hello.txt')
  await tui.waitFor('thefilesayshi', {timeout: 15_000})
}, 30_000)
