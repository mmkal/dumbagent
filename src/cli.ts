#!/usr/bin/env node
import {createDumbAgent} from './api.ts'
import {elizaResponder} from './presets/eliza.ts'
import {sarcasticResponder} from './presets/sarcastic.ts'
import {withSimulatedToolCalls} from './tools.ts'

const presets = {
  sarcastic: sarcasticResponder,
  eliza: elizaResponder,
}

const presetName = process.env.DUMBAGENT_PRESET || 'sarcastic'
const preset = presets[presetName as keyof typeof presets]
if (!preset) {
  console.error(`Unknown DUMBAGENT_PRESET "${presetName}". Available presets: ${Object.keys(presets).join(', ')}`)
  process.exit(1)
}

const api = await createDumbAgent({fetch: withSimulatedToolCalls(preset)})
api.createCli().run()
