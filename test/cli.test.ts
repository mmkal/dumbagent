import {spawn} from 'node:child_process'
import {mkdtemp, writeFile, chmod, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test, expect} from 'vitest'
import {waitForExit} from './helpers/index.ts'

const repoRoot = new URL('..', import.meta.url).pathname

test('node src/cli.ts codex serves the sarcastic preset', async () => {
  await using shims = await dumbAgentCommandShims()

  const child = spawn(process.execPath, ['src/cli.ts', 'codex', 'exec', '--json', 'hello from codex'], {
    cwd: repoRoot,
    env: {...process.env, PATH: `${shims.dir}:${process.env.PATH}`},
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 5_000)

  expect({exitCode, stderr}).toMatchObject({exitCode: 0})
  expect(stdout.toLowerCase()).toContain('hello from codex')
  expect(stdout).toContain('do you hear yourself')
})

test('node src/cli.ts opencode serves the sarcastic preset', async () => {
  await using shims = await dumbAgentCommandShims()

  const child = spawn(process.execPath, ['src/cli.ts', 'opencode', 'run', 'hello from opencode'], {
    cwd: repoRoot,
    env: {...process.env, PATH: `${shims.dir}:${process.env.PATH}`},
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 5_000)

  expect({exitCode, stderr}).toMatchObject({exitCode: 0})
  expect(stdout.toLowerCase()).toContain('hello from opencode')
  expect(stdout).toContain('do you hear yourself')
})

test('node src/cli.ts claude serves the sarcastic preset', async () => {
  await using shims = await dumbAgentCommandShims()

  const child = spawn(process.execPath, ['src/cli.ts', 'claude', '-p', 'hello from claude'], {
    cwd: repoRoot,
    env: {...process.env, PATH: `${shims.dir}:${process.env.PATH}`},
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 5_000)

  expect({exitCode, stderr}).toMatchObject({exitCode: 0})
  expect(stdout.toLowerCase()).toContain('hello from claude')
  expect(stdout).toContain('do you hear yourself')
})

test('node src/cli.ts pi serves the sarcastic preset', async () => {
  await using shims = await dumbAgentCommandShims()

  const child = spawn(process.execPath, ['src/cli.ts', 'pi', '-p', 'hello from pi'], {
    cwd: repoRoot,
    env: {...process.env, PATH: `${shims.dir}:${process.env.PATH}`},
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 5_000)

  expect({exitCode, stderr}).toMatchObject({exitCode: 0})
  expect(stdout.toLowerCase()).toContain('hello from pi')
  expect(stdout).toContain('do you hear yourself')
})

test('node src/cli.ts grok serves the sarcastic preset', async () => {
  await using shims = await dumbAgentCommandShims()

  const child = spawn(process.execPath, ['src/cli.ts', 'grok', '-p', 'hello from grok'], {
    cwd: repoRoot,
    env: {...process.env, PATH: `${shims.dir}:${process.env.PATH}`},
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 5_000)

  expect({exitCode, stderr}).toMatchObject({exitCode: 0})
  expect(stdout.toLowerCase()).toContain('hello from grok')
  expect(stdout).toContain('do you hear yourself')
})

test('DUMBAGENT_PRESET=eliza selects the ELIZA preset', async () => {
  await using shims = await dumbAgentCommandShims()

  const child = spawn(process.execPath, ['src/cli.ts', 'claude', '-p', 'I need help'], {
    cwd: repoRoot,
    env: {...process.env, DUMBAGENT_PRESET: 'eliza', PATH: `${shims.dir}:${process.env.PATH}`},
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const {exitCode, stdout, stderr} = await waitForExit(child, 5_000)

  expect({exitCode, stderr}).toMatchObject({exitCode: 0})
  expect(stdout).toContain('Why do you need help?')
  expect(stdout).not.toContain('do you hear yourself')
})

async function dumbAgentCommandShims() {
  const dir = await mkdtemp(join(tmpdir(), 'dumbagent-cli-shims-'))
  const shimPath = join(dir, 'agent-shim.mjs')
  await writeFile(shimPath, agentShimSource())
  await chmod(shimPath, 0o755)
  for (const command of ['codex', 'opencode', 'claude', 'pi', 'grok']) {
    const commandPath = join(dir, command)
    await writeFile(commandPath, `#!/usr/bin/env sh\nDUMBAGENT_SHIM_COMMAND="${command}" exec "${process.execPath}" "${shimPath}" "$@"\n`)
    await chmod(commandPath, 0o755)
  }

  return {
    dir,
    async [Symbol.asyncDispose]() {
      await rm(dir, {recursive: true, force: true})
    },
  }
}

function agentShimSource() {
  return String.raw`#!/usr/bin/env node
import {readFile} from 'node:fs/promises'

const command = process.env.DUMBAGENT_SHIM_COMMAND
const args = process.argv.slice(2)
const prompt = promptFromArgs(args)

if (command === 'codex') {
  const config = await readFile(process.env.CODEX_HOME + '/config.toml', 'utf8')
  const baseUrl = config.match(/openai_base_url = "([^"]+)"/)[1]
  const response = await fetch(baseUrl + '/responses', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: 'fake-model', input: prompt}),
  })
  const json = await response.json()
  console.log(json.output[0].content[0].text)
  process.exit(0)
}

if (command === 'opencode') {
  const config = JSON.parse(process.env.OPENCODE_CONFIG_CONTENT)
  const baseUrl = config.provider.dumbagent.api
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: 'fake-model', messages: [{role: 'user', content: prompt}]}),
  })
  const json = await response.json()
  console.log(json.choices[0].message.content)
  process.exit(0)
}

if (command === 'claude') {
  const response = await fetch(process.env.ANTHROPIC_BASE_URL + '/v1/messages', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: 'fake-model', messages: [{role: 'user', content: prompt}]}),
  })
  const json = await response.json()
  console.log(json.content[0].text)
  process.exit(0)
}

if (command === 'pi') {
  const config = JSON.parse(await readFile(process.env.PI_CODING_AGENT_DIR + '/models.json', 'utf8'))
  const baseUrl = config.providers.dumbagent.baseUrl
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: 'fake-model', messages: [{role: 'user', content: prompt}]}),
  })
  const json = await response.json()
  console.log(json.choices[0].message.content)
  process.exit(0)
}

if (command === 'grok') {
  const config = await readFile(process.env.GROK_HOME + '/config.toml', 'utf8')
  const baseUrl = config.match(/base_url = "([^"]+)"/)[1]
  const response = await fetch(baseUrl + '/chat/completions', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({model: 'fake-model', messages: [{role: 'user', content: prompt}]}),
  })
  const json = await response.json()
  console.log(json.choices[0].message.content)
  process.exit(0)
}

console.error('unknown shim command: ' + command)
process.exit(1)

function promptFromArgs(args) {
  const claudePrompt = args.indexOf('-p')
  if (claudePrompt !== -1) {
    return args[claudePrompt + 1]
  }

  const opencodeRun = args.indexOf('run')
  if (opencodeRun !== -1) {
    return args.slice(opencodeRun + 1).join(' ')
  }

  const codexJson = args.indexOf('--json')
  if (codexJson !== -1) {
    return args.slice(codexJson + 1).join(' ')
  }

  return args.join(' ')
}
`
}
