#!/usr/bin/env node
import {createFakeAgent} from './api.ts'
import {elizaResponder} from './presets/eliza.ts'
import {sarcasticResponder} from './presets/sarcastic.ts'
import {withSimulatedToolCalls} from './tools.ts'

const presets = {
  sarcastic: sarcasticResponder,
  eliza: elizaResponder,
}

const presetName = process.env.FAKEAGENT_PRESET || 'sarcastic'
const preset = presets[presetName as keyof typeof presets]
if (!preset) {
  console.error(`Unknown FAKEAGENT_PRESET "${presetName}". Available presets: ${Object.keys(presets).join(', ')}`)
  process.exit(1)
}

const api = await createFakeAgent({fetch: withSimulatedToolCalls(preset)})
api.createCli().run()
