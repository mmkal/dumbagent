import {spawn} from 'node:child_process'
import type {DumbAgent} from '../../src/api.ts'
import type {AgentName} from '../../src/agents.ts'

export {waitForExit} from './spawn.ts'

export interface TuiHandle extends AsyncDisposable {
  /** Type text and press Enter */
  send(text: string): Promise<void>
  /** Press Enter (to dismiss a startup prompt) */
  dismiss(): Promise<void>
  /** Wait for a string to appear in the TUI output */
  waitFor(pattern: string, options?: {timeout?: number}): Promise<void>
  /** Get the current TUI output (cleaned of ANSI escapes) */
  output(): Promise<string>
}

export interface SpawnTuiOptions {
  /** How to submit: "cr" (Enter) or "lf-cr" (\n then \r, needed for opencode) */
  submit?: 'cr' | 'lf-cr'
}

/**
 * Spawn an agent CLI in a real PTY and return a handle for interacting with it.
 */
export async function spawnTui(
  api: DumbAgent,
  agent: AgentName,
  options?: SpawnTuiOptions,
): Promise<TuiHandle> {
  const {command, args: agentArgs, env} = api.getSpawnArgs(agent)

  const child = spawn('bun', ['test/helpers/tui-server.ts'], {
    env: {
      ...process.env,
      ...env,
      PTY_COMMAND: command,
      PTY_ARGS: JSON.stringify(agentArgs),
      PTY_SUBMIT: options?.submit ?? 'cr',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    cwd: import.meta.dirname + '/../..',
  })

  // The tui-server prints its control port on the first line of stdout
  const controlPort = await new Promise<number>((resolve, reject) => {
    let buf = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout>
    const onData = (d: Buffer) => {
      buf += d.toString()
      const nl = buf.indexOf('\n')
      if (nl !== -1) {
        settled = true
        clearTimeout(timer)
        child.stdout!.off('data', onData)
        resolve(parseInt(buf.slice(0, nl).trim()))
      }
    }
    child.stdout!.on('data', onData)
    child.on('exit', (code) => {
      if (!settled) reject(new Error(`TUI server exited early (code ${code})`))
    })
    timer = setTimeout(() => {
      child.stdout!.off('data', onData)
      child.kill()
      reject(new Error(`Timed out waiting for TUI server port.\nbuf: ${buf}`))
    }, 10_000)
  })

  const base = `http://localhost:${controlPort}`
  if (agent === 'claude') {
    await acceptClaudeTrustPrompt(base)
  }

  return {
    async send(text) {
      await fetch(`${base}/send`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({text}),
      })
    },
    async dismiss() {
      await fetch(`${base}/dismiss`, {method: 'POST'})
    },
    async waitFor(pattern, {timeout = 10_000} = {}) {
      const res = await fetch(`${base}/wait`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({pattern, timeout}),
      })
      const {found} = await res.json() as {found: boolean}
      if (!found) {
        const outRes = await fetch(`${base}/output`)
        const {clean} = await outRes.json() as {clean: string}
        throw new Error(`Timed out waiting for "${pattern}". Output: ${JSON.stringify(clean.slice(-500))}`)
      }
    },
    async output() {
      const res = await fetch(`${base}/output`)
      const {clean} = await res.json() as {clean: string}
      return clean
    },
    async [Symbol.asyncDispose]() {
      await fetch(`${base}/kill`, {method: 'POST'}).catch(() => {})
      child.kill()
    },
  }
}

async function acceptClaudeTrustPrompt(base: string): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const res = await fetch(`${base}/output`)
    const {clean} = await res.json() as {clean: string}
    if (clean.includes('Yes, I trust this folder')) {
      await fetch(`${base}/dismiss`, {method: 'POST'})
      return
    }
    if (clean.includes('Haiku')) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
}
