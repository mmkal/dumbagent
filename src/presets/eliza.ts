import {parseRequest} from '../api.ts'

/*
 * Adapted from Keith Weaver's pure JavaScript ELIZA implementation:
 * https://github.com/keithweaver/eliza/blob/gh-pages/js/eliza.js
 *
 * Original license: MIT, Copyright (c) 2020 Keith Weaver.
 *
 * Modifications:
 * - converted browser globals into a dependency-free TypeScript module;
 * - removed DOM rendering, timers, and Array.prototype mutation;
 * - preserved the response tables, synonyms, wildcard handling, and word reflection;
 * - removed the one-off emotional overrides so "i am sad" rotates through the broader "i am" rule;
 * - added DumbAgent Request/Response helpers.
 *
 * MIT License
 *
 * Copyright (c) 2020 Keith Weaver
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

interface ResponseRule {
  weight: number
  responses: string[]
}

interface Keyword {
  word: string
  weight: number
}

interface WildcardRule {
  weight: number
  replacementWord: string
}

const responses: Record<string, ResponseRule> = {
  NOTFOUND: {
    weight: 0,
    responses: [
      'What does that suggest to you?',
      'I see.',
      "I'm not sure I understand you fully.",
      'Can you elaborate?',
      'That is quite interesting.',
      'Please tell me more.',
      "Let's change focus a bit... Tell me about your family.",
      'Can you elaborate on that?',
      'Why do you say that *?',
    ],
  },
  sorry: {
    weight: 1,
    responses: ["Please don't apologize.", 'Apologies are not necessary.', 'Apologies are not required.'],
  },
  always: {
    weight: 1,
    responses: ['Can you think of a specific example?'],
  },
  because: {
    weight: 6,
    responses: ['Is that the real reason?'],
  },
  maybe: {
    weight: 1,
    responses: ["You don't seem very certain."],
  },
  'i think': {
    weight: 2,
    responses: ['Do you really think so?'],
  },
  you: {
    weight: 1,
    responses: ['We were discussing you, not me.', 'Why do you say that about me?', 'Why do you care whether I "*"?'],
  },
  yes: {
    weight: 1,
    responses: ['Why do you think so?', 'You seem quite positive.'],
  },
  no: {
    weight: 1,
    responses: ['Why not?', 'Are you sure?'],
  },
  'i am': {
    weight: 1,
    responses: [
      'I am sorry to hear you are *.',
      'How long have you been *?',
      'Do you believe it is normal to be *?',
      'Do you enjoy being *?',
      'Did you come to me because you are *?',
    ],
  },
  'i feel': {
    weight: 4,
    responses: ['Tell me more about such feelings.', 'Do you often feel *?', 'Do you enjoy feeling *?', 'Why do you feel that way?'],
  },
  family: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  mother: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  father: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  mom: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  sister: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  brother: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  husband: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  wife: {
    weight: 16,
    responses: ['Tell me more about your family.', 'How do you get along with your family?', 'Is your family important to you?'],
  },
  child: {
    weight: 16,
    responses: [
      'Did you have close friends as a child?',
      'What is your favorite childhood memory?',
      'Do you remember any dreams or nightmares from childhood?',
      'Did the other children sometimes tease you?',
      'How do you think your childhood experiences relate to your feelings today?',
    ],
  },
  dreamed: {
    weight: 4,
    responses: [
      'What does that dream suggest to you?',
      'Do you dream often?',
      'What people appear in your dreams?',
      'Are you disturbed by your dreams?',
      'Have you ever fantasized * while you were awake?',
    ],
  },
  nightmare: {
    weight: 3,
    responses: ['What does that dream suggest to you?', 'Do you dream often?', 'What persons appear in your dreams?', 'Are you disturbed by your dreams?'],
  },
  hello: {
    weight: 1,
    responses: ['Hi again! How is going?', 'How are you today? Any problems?'],
  },
  'good afternoon': {
    weight: 1,
    responses: ['Hi again! How is going?', 'How are you today? Any problems?'],
  },
  'good morning': {
    weight: 1,
    responses: ['Hi again! How is going?', 'How are you today? Any problems?'],
  },
  hi: {
    weight: 1,
    responses: ['Hi again! How is going?', 'How are you today? Any problems?'],
  },
  goodbye: {
    weight: 1,
    responses: ['Goodbye.  Thank you for talking to me.'],
  },
  'i need': {
    weight: 5,
    responses: ['Why do you need *?', 'Would it really help you to get *?', 'Are you sure you need *?'],
  },
  "why don't you": {
    weight: 3,
    responses: ["Do you really think I don't *?", 'Perhaps eventually I will *.', 'Do you really want me to *?'],
  },
  "why can't i": {
    weight: 3,
    responses: ['Do you think you should be able to *?', 'If you could *, what would you do?', "I don't know -- why can't you *?", 'Have you really tried?'],
  },
  "i can't": {
    weight: 4,
    responses: ['How do you know you can\'t "*"?', 'Perhaps you could * if you tried.', 'What would it take for you to *?'],
  },
  perhaps: {
    weight: 1,
    responses: ['How do you know you can\'t "*"?', 'Perhaps you could * if you tried.', 'What would it take for you to *?'],
  },
  remember: {
    weight: 5,
    responses: [
      'Do you often think of *?',
      'Does thinking of * bring anything else to mind',
      'What else do you recollect?',
      'Why do you recollect * just now?',
      'What in the present situation reminds you of *?',
      'What is the connection between me and *?',
    ],
  },
  'do you remember': {
    weight: 6,
    responses: ['Do you think I would forget?', 'Yes I do remember *.'],
  },
  if: {
    weight: 3,
    responses: ["Do you think it's likely that *?", 'Do you wish that *?', 'What do you know about *?', 'Really, if *?'],
  },
  name: {
    weight: 15,
    responses: ['I am not interested in names.', "I've told you before, I do not care about names -- please continue."],
  },
  'another language': {
    weight: 1,
    responses: ["I told you before, I don't understand languages that are not English."],
  },
  computer: {
    weight: 12,
    responses: [
      'Do computers worry you?',
      'Why do you mention computers?',
      'Could you expand on how computers and * are related?',
      'What do you think machines have to do with your problem?',
      "Don't you think computers can help people?",
      'What about machines worrys you?',
      'What do you think about machines?',
    ],
  },
  'are you': {
    weight: 2,
    responses: ['Why are you interested in whether I am * or not?', "Would you prefer if I weren't *?", 'Perhaps I am * in your fantasies.', 'Do you sometimes think I am *?'],
  },
  are: {
    weight: 1,
    responses: ['Did you think they might not be *?', 'Would you like it if they were not *?', 'What if they were not *?', 'Possibly they are *.'],
  },
  your: {
    weight: 1,
    responses: ['Why are you concerned over my *?', 'What about your own *?', "Are you worried about someone else's *?", 'Really, my *?'],
  },
  'was i': {
    weight: 2,
    responses: ['What if you were *?', 'Do you think you were *?', 'Were you *?', 'What would it mean if you were *?', 'What does * suggest to you?'],
  },
  'was you': {
    weight: 2,
    responses: ['Would you like to believe I was *?', 'What suggests that I was *?', 'What do you think?'],
  },
  'i desire': {
    weight: 1,
    responses: ['What would it mean to you if you got it?', 'Why do you want it?', 'What if you never got it?'],
  },
  'i desired': {
    weight: 1,
    responses: ['Did you achieve it or simply moved on?'],
  },
}

const synonyms: Record<string, string[]> = {
  sorry: ['apologise'],
  'another language': ['deutsch', 'francais', 'french', 'italiano', 'italian', 'espanol', 'spanish', 'xforeign'],
  dreamed: ['dream', 'dreams'],
  'i am': ['am i', 'im', "i'm"],
  you: ["you're", 'you are'],
  'was i': ['i was'],
}

const responsesWithWildcard: Record<string, WildcardRule> = {
}

const initialMessages = ['Hello. How are you feeling today?']
const endChatTerms = ['goodbye', 'i have to leave', 'quit', 'bye', 'exit']
const keywords = getKeywordsByWeight()

export class ElizaBot {
  private conversationOver = false
  private responseCursors: Record<string, number> = {}

  initial() {
    return initialMessages[0]
  }

  respond(message: string) {
    const cleanMessage = processInput(message)
    if (!cleanMessage) {
      return this.initial()
    }
    if (this.conversationOver) {
      return 'Our conversation has ended. Refresh the page to start again.'
    }

    return this.analyze(cleanMessage)
  }

  private analyze(message: string) {
    let input = message
    if (endChatTerms.includes(input)) {
      this.conversationOver = true
      input = 'goodbye'
    }

    for (const keyword of keywords) {
      const matchedWord = keyword.word.includes('*')
        ? containsKeywordWithWildcard(input, keyword.word)
          ? findBasicKeywordFromKeywordWithWildcard(keyword.word)
          : ''
        : phraseAppears(input, keyword.word)
          ? keyword.word
          : ''

      if (!matchedWord) {
        continue
      }

      const response = this.selectResponse(matchedWord)
      if (!response.includes('*')) {
        return response
      }
      return fillWildcard(response, input, keyword.word)
    }

    return this.selectResponse('NOTFOUND')
  }

  private selectResponse(word: string) {
    const potentialResponses = responses[word] || findResponsesForSimilarWord(word) || responses.NOTFOUND
    const index = this.responseCursors[word] || 0
    const response = potentialResponses.responses[index % potentialResponses.responses.length]
    this.responseCursors[word] = index + 1
    return response
  }
}

const eliza = new ElizaBot()

export async function elizaResponder(request: Request): Promise<Response> {
  const parsed = await parseRequest(request)
  return parsed.respond.text(eliza.respond(parsed.lastMessage))
}

export function formatElizaResponse(text: string) {
  return new ElizaBot().respond(text)
}

function getKeywordsByWeight() {
  const weights: number[] = []
  const tempKeywords: Record<string, number> = {}

  for (const responseKeyword of Object.keys(responses)) {
    const weight = responses[responseKeyword].weight
    tempKeywords[responseKeyword] = weight
    if (!weights.includes(weight)) {
      weights.push(weight)
    }
  }

  for (const wordWithResponse of Object.keys(synonyms)) {
    if (tempKeywords[wordWithResponse] === undefined) {
      continue
    }
    const weight = tempKeywords[wordWithResponse]
    for (const similarWord of synonyms[wordWithResponse]) {
      tempKeywords[similarWord] = weight
    }
  }

  for (const word of Object.keys(responsesWithWildcard)) {
    const weight = responsesWithWildcard[word].weight
    if (!weights.includes(weight)) {
      weights.push(weight)
    }
    tempKeywords[word] = weight
  }

  const result: Keyword[] = []
  for (const weight of weights.sort((a, b) => b - a)) {
    for (const word of Object.keys(tempKeywords)) {
      if (tempKeywords[word] === weight && word !== 'NOTFOUND') {
        result.push({word, weight})
      }
    }
  }
  return result
}

function processInput(message: string) {
  return message
    .toLowerCase()
    .replace(/[,\;.?!:]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function phraseAppears(input: string, phrase: string) {
  return ` ${input} `.includes(` ${phrase} `)
}

function fillWildcard(response: string, input: string, matchedWord: string) {
  const wildcardInput = inputAfterMatch(input, matchedWord)
  const reflectedInput = replaceWords(wildcardInput) || 'that'
  return response.replace('*', reflectedInput)
}

function inputAfterMatch(input: string, matchedWord: string) {
  if (matchedWord.includes('*')) {
    const replacementWord = responsesWithWildcard[matchedWord].replacementWord
    return inputAfterMatch(input, replacementWord)
  }
  const index = input.indexOf(matchedWord)
  if (index === -1) {
    return ''
  }
  return input.slice(index + matchedWord.length).trim()
}

function replaceWords(input: string) {
  const wordsForReplacement: Record<string, string> = {
    i: 'you',
    you: 'i',
    me: 'you',
    my: 'your',
    am: 'are',
    are: 'am',
    was: 'were',
    "i'd": 'you would',
    "i've": 'you have',
    "i'll": 'you will',
    "you've": 'i have',
    "you'll": 'i will',
    your: 'my',
    yours: 'mine',
  }

  return input
    .split(' ')
    .filter(Boolean)
    .map((word) => wordsForReplacement[word] || word)
    .join(' ')
}

function findResponsesForSimilarWord(word: string) {
  for (const key of Object.keys(synonyms)) {
    if (synonyms[key].includes(word)) {
      return responses[key]
    }
  }
  return null
}

function containsKeywordWithWildcard(input: string, keywordsWithWildcardStr: string) {
  const info = getResponseWildcardInfo(keywordsWithWildcardStr)
  if (!info) {
    return false
  }

  const words = input.split(' ').filter(Boolean)
  const before = info.keywords.slice(0, info.wordBeforeWildcard + 1)
  const after = info.keywords.slice(info.wordBeforeWildcard + 1)

  for (let start = 0; start <= words.length - before.length; start++) {
    if (!matchesAt(words, before, start)) {
      continue
    }
    for (let gap = info.minNumWords; gap <= info.maxNumWords; gap++) {
      const afterStart = start + before.length + gap
      if (matchesAt(words, after, afterStart)) {
        return true
      }
    }
  }
  return false
}

function findBasicKeywordFromKeywordWithWildcard(keywordsWithWildcardStr: string) {
  return responsesWithWildcard[keywordsWithWildcardStr].replacementWord
}

function getResponseWildcardInfo(keywordsWithWildcardStr: string) {
  const parts = keywordsWithWildcardStr.split(' ')
  const wildcardIndex = parts.findIndex((part) => part.includes('*'))
  if (wildcardIndex === -1) {
    return null
  }

  const rules = parts[wildcardIndex].replace(/\*/g, '').split('-')
  const minNumWords = Number.parseInt(rules[0], 10)
  const maxNumWords = Number.parseInt(rules[1], 10)
  if (!Number.isFinite(minNumWords) || !Number.isFinite(maxNumWords)) {
    return null
  }

  return {
    minNumWords,
    maxNumWords,
    wordBeforeWildcard: wildcardIndex - 1,
    wordAfterWildcard: wildcardIndex,
    keywords: parts.filter((part) => part !== parts[wildcardIndex]),
  }
}

function matchesAt(input: string[], expected: string[], start: number) {
  if (start < 0 || start + expected.length > input.length) {
    return false
  }
  return expected.every((word, index) => input[start + index] === word)
}
