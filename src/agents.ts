import type {SpawnOptions} from 'node:child_process'
import {createHash} from 'node:crypto'
import {mkdirSync, realpathSync, writeFileSync} from 'node:fs'

export interface AgentConfig {
  command: string
  args?: string[]
  spawnOptions?: SpawnOptions
  getEnv(port: number): Record<string, string>
}

function hashText(text: string) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12)
}

export const agents = {
  opencode: {
    command: 'opencode',
    // stdin must be ignored — opencode reads stdin to EOF when it's not a TTY, causing hangs
    spawnOptions: {stdio: ['ignore', 'pipe', 'pipe']},
    getEnv(port) {
      const config = {
        provider: {
          dumbagent: {
            name: 'Dumb Agent',
            api: `http://localhost:${port}/v1`,
            models: {
              'fake-model': {
                name: 'Fake Model',
                tool_call: true,
                reasoning: false,
                attachment: false,
                temperature: true,
                limit: {context: 128000, output: 8192},
                cost: {input: 0, output: 0},
                release_date: '2025-01-01',
              },
            },
          },
        },
        model: 'dumbagent/fake-model',
        // Disable MCP servers to avoid spending seconds connecting to user's configured servers
        mcp: {},
      }
      return {
        OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
        ANTHROPIC_API_KEY: 'fake-key',
        OPENAI_API_KEY: 'fake-key',
        // Auto-allow all tool permissions so TUI tests don't get blocked by prompts
        OPENCODE_PERMISSION: JSON.stringify({'*': 'allow'}),
        // Isolate from user's global config (MCP servers, plugins, etc.) and database
        XDG_CONFIG_HOME: `/tmp/dumbagent-opencode-config-${port}`,
        XDG_DATA_HOME: `/tmp/dumbagent-opencode-data-${port}`,
      }
    },
  },
  claude: {
    command: 'claude',
    // --bare: skip OAuth/keychain, use only ANTHROPIC_API_KEY. Also skips hooks, LSP, etc.
    args: ['--bare', '--allow-dangerously-skip-permissions', '--dangerously-skip-permissions', "--model", "haiku"],
    getEnv(port) {
      return {
        ANTHROPIC_BASE_URL: `http://localhost:${port}`,
        ANTHROPIC_API_KEY: 'fake-key',
      }
    },
  },
  codex: {
    command: 'codex',
    args: [],
    spawnOptions: {stdio: ['ignore', 'pipe', 'pipe']},
    getEnv(port) {
      const dir = `/tmp/dumbagent-codex-home-${port}`
      mkdirSync(dir, {recursive: true})
      // Trust the cwd and /tmp/dumbagent-test so codex skips trust/onboarding prompts.
      // Use realpathSync because macOS resolves /tmp → /private/tmp and codex checks the resolved path.
      const cwd = realpathSync(process.cwd())
      const tmpTest = realpathSync('/tmp/dumbagent-test')
      const trustedPaths = [...new Set([cwd, tmpTest])]
      writeFileSync(`${dir}/config.toml`, [
        `model = "gpt-5.4"`,
        `approval_policy = "never"`,
        `sandbox_mode = "danger-full-access"`,
        `openai_base_url = "http://localhost:${port}/v1"`,
        `check_for_update_on_startup = false`,
        ...trustedPaths.flatMap((p) => ['', `[projects.${JSON.stringify(p)}]`, `trust_level = "trusted"`]),
      ].join('\n') + '\n')
      writeFileSync(`${dir}/auth.json`, JSON.stringify({OPENAI_API_KEY: 'fake-key'}))
      return {
        CODEX_API_KEY: 'fake-key',
        CODEX_HOME: dir,
      }
    },
  },
  pi: {
    command: 'pi',
    args: [
      '--provider', 'dumbagent',
      '--model', 'fake-model',
      '--api-key', 'fake-key',
      '--no-context-files',
      '--no-extensions',
      '--no-skills',
      '--no-prompt-templates',
      '--no-themes',
      '--no-session',
    ],
    spawnOptions: {stdio: ['ignore', 'pipe', 'pipe']},
    getEnv(port) {
      const providerConfig = {
        api: 'openai-completions',
        apiKey: 'DUMBAGENT_PI_API_KEY',
        models: [{
          id: 'fake-model',
          name: 'Fake Model',
          reasoning: false,
          input: ['text'],
          contextWindow: 128000,
          maxTokens: 8192,
          cost: {input: 0, output: 0, cacheRead: 0, cacheWrite: 0},
        }],
      }
      const profileHash = hashText(JSON.stringify(providerConfig))
      const dir = `/tmp/dumbagent-pi-home-${profileHash}`
      const sessionDir = `/tmp/dumbagent-pi-sessions-${profileHash}`
      mkdirSync(dir, {recursive: true})
      mkdirSync(sessionDir, {recursive: true})
      writeFileSync(`${dir}/models.json`, JSON.stringify({
        providers: {
          dumbagent: {
            baseUrl: `http://localhost:${port}/v1`,
            ...providerConfig,
          },
        },
      }, null, 2) + '\n')
      return {
        DUMBAGENT_PI_API_KEY: 'fake-key',
        PI_CODING_AGENT_DIR: dir,
        PI_CODING_AGENT_SESSION_DIR: sessionDir,
        PI_SKIP_VERSION_CHECK: '1',
        PI_TELEMETRY: '0',
      }
    },
  },
  grok: {
    command: 'grok',
    args: [
      '--always-approve',
      '--no-auto-update',
      '--no-subagents',
      '--no-plan',
      '--disable-web-search',
      '-m', 'fake-model',
    ],
    spawnOptions: {stdio: ['ignore', 'pipe', 'pipe']},
    getEnv(port) {
      const dir = `/tmp/dumbagent-grok-home-${port}`
      mkdirSync(dir, {recursive: true})
      mkdirSync('/tmp/dumbagent-test', {recursive: true})
      const cwd = realpathSync(process.cwd())
      const tmpTest = realpathSync('/tmp/dumbagent-test')
      const trustedPaths = [...new Set([cwd, tmpTest])]
      writeFileSync(`${dir}/config.toml`, [
        `[cli]`,
        `auto_update = false`,
        ``,
        `[models]`,
        `default = "fake-model"`,
        ``,
        `[model.fake-model]`,
        `model = "fake-model"`,
        `base_url = "http://127.0.0.1:${port}/v1"`,
        `name = "Fake Model"`,
        `api_key = "fake-key"`,
        `api_backend = "chat_completions"`,
        `context_window = 128000`,
        ``,
        `[features]`,
        `telemetry = false`,
        `remote_fetch = false`,
        `codebase_indexing = false`,
        ``,
        `[ui]`,
        `permission_mode = "always-approve"`,
        ``,
        `[privacy]`,
        `privacy_banner_acked = "2020-01-01T00:00:00Z"`,
        ``,
        `[compat.claude]`,
        `mcps = false`,
        `skills = false`,
        `rules = false`,
        `agents = false`,
        `hooks = false`,
        ``,
        `[compat.cursor]`,
        `mcps = false`,
        `skills = false`,
        `rules = false`,
        `agents = false`,
        `hooks = false`,
      ].join('\n') + '\n')
      writeFileSync(`${dir}/trusted_folders.toml`, trustedPaths
        .map((p) => `[folders.${JSON.stringify(p)}]\ntrusted = true\n`)
        .join('\n'))
      writeFileSync(`${dir}/tip_cursor.json`, JSON.stringify({cursor: 9999}))
      return {
        GROK_HOME: dir,
        XAI_API_KEY: 'fake-key',
        GROK_DISABLE_AUTOUPDATER: '1',
        GROK_TELEMETRY_ENABLED: '0',
        GROK_MEMORY: '0',
        GROK_SUBAGENTS: '0',
        GROK_WORKFLOWS: '0',
      }
    },
  },
} satisfies Record<string, AgentConfig>

export type AgentName = keyof typeof agents
