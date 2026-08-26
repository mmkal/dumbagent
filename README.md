# dumbagent

Fake API server for testing tools that use coding agent CLIs (Claude Code, OpenAI Codex, opencode, Pi, Grok). Intercepts LLM requests, gives you deterministic instant responses.

## Why

You built a tool that spawns `claude` or `codex` as a subprocess. You want to test it without hitting real APIs, spending money, waiting seconds, or getting nondeterministic output.

## Install

```sh
npm install dumbagent
```

## Usage

### Directly

```sh
npx dumbagent codex
npx dumbagent opencode
npx dumbagent claude
npx dumbagent pi
npx dumbagent grok
```

By default the wrapped agent talks to a local fake API that returns the bundled sarcastic responder preset.

Set `DUMBAGENT_PRESET=eliza` to use the bundled ELIZA responder instead.

```sh
DUMBAGENT_PRESET=eliza npx dumbagent claude
```

The default CLI also recognizes `tool:["readFile","<path>"]` and replies with the wrapped agent's read-file tool call shape.

### In tests

```ts
import {createDumbAgent, parseRequest} from 'dumbagent'

const api = await createDumbAgent({
  async fetch(request) {
    const parsed = await parseRequest(request)
    if (parsed.lastMessage.match(/review.*pr/i)) {
      return parsed.respond.text('LGTM, no issues found.')
    }
    return parsed.respond.text('Done.')
  },
})

// spawn your tool, which internally runs `claude -p "review this PR"`
const result = await myTool.reviewPR({
  command: `node my-cli.js --agent-command="${api.spawnCommand('claude')}"`,
})

expect(result.summary).toContain('LGTM')

await api[Symbol.asyncDispose]()
```

### As a CLI wrapper

```ts
// fake-claude.ts
import {createDumbAgent, parseRequest} from 'dumbagent'

const api = await createDumbAgent({
  async fetch(request) {
    const parsed = await parseRequest(request)
    if (parsed.lastMessage.match(/one plus two/)) {
      return parsed.respond.text('three')
    }
    return Response.json({error: 'no match'}, {status: 400})
  },
})

api.createCli().run() // reads agent name from argv
```

```sh
node fake-claude.ts claude      # opens claude TUI pointed at your fake server
node fake-claude.ts opencode    # same for opencode
node fake-claude.ts codex       # same for codex
node fake-claude.ts pi          # same for pi
node fake-claude.ts grok        # same for grok
```

## Supported agents

| Agent | Protocol | Redirect mechanism |
|-------|----------|--------------------|
| `codex` | OpenAI Responses API (WebSocket) | `config.toml` with `openai_base_url` |
| `opencode` | OpenAI Chat Completions | Custom provider via `OPENCODE_CONFIG_CONTENT` |
| `claude` | Anthropic Messages API | `ANTHROPIC_BASE_URL` + `--bare` |
| `pi` | OpenAI Chat Completions | Isolated `models.json` via `PI_CODING_AGENT_DIR` |
| `grok` | OpenAI Chat Completions | Isolated `GROK_HOME` with custom model `base_url` |

## API

### `createDumbAgent(options)`

Starts an HTTP (+ WebSocket) server on a random port.

```ts
const api = await createDumbAgent({
  port: 8080, // optional, default: random
  fetch(request) { // standard Request -> Response
    return new Response('hello')
  },
})
```

Returns `DumbAgent` (implements `AsyncDisposable`):
- `api.port` - server port
- `api.spawn(agent, args?, options?)` - spawn agent CLI as child process
- `api.createCli()` - returns `{run()}`, reads agent name from `process.argv`
- `api.getSpawnArgs(agent)` - raw `{command, args, env, spawnOptions}` for manual spawning

### `parseRequest(request)`

Detects protocol from URL path, parses body.

```ts
const parsed = await parseRequest(request)

parsed.lastMessage              // last user message, plain string
parsed.respond.text('hello')    // Response in the right format for the detected protocol

parsed.openai?.lastMessage      // non-null for /v1/chat/completions
parsed.anthropic?.lastMessage   // non-null for /v1/messages
parsed.codex?.lastMessage       // non-null for /v1/responses

parsed.body                     // raw parsed JSON
```

### `responses`

For explicit protocol control:

```ts
import {responses} from 'dumbagent'

responses.openai.text('hello')     // OpenAI chat completion Response
responses.anthropic.text('hello')  // Anthropic message Response
responses.codex.text('hello')      // OpenAI responses API Response
```

JSON responses are auto-converted to SSE/streaming when the client requests it.
