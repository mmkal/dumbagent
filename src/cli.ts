#!/usr/bin/env node
import {createFakeAgent} from './api.ts'
import {sarcasticResponder} from './presets/sarcastic.ts'

const api = await createFakeAgent({fetch: sarcasticResponder})
api.createCli().run()
