import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildMessages,
  cleanTitle,
  coalesceRoles,
  fallbackTitle,
  systemPrompt,
  titlePrompt,
  userContent,
} from './context'
import type { ConversationGraph, Lane, Reply, Turn } from './types'

function makeGraph(
  turns: Turn[],
  replies: Reply[],
  lanes: Lane[],
  activeLeafTurnId?: string,
): ConversationGraph {
  return {
    conversation: {
      id: 'c',
      title: 't',
      pinned: false,
      createdAt: 0,
      updatedAt: 0,
      lanes,
      activeLeafTurnId,
    },
    turns,
    replies,
  }
}

const laneA: Lane = { id: 'a', model: { providerId: 'p', modelId: 'm' } }

function turn(id: string, parentTurnId?: string, text = `q-${id}`): Turn {
  return { id, conversationId: 'c', parentTurnId, text, createdAt: 0 }
}

function reply(
  turnId: string,
  laneId: string,
  text: string,
  patch: Partial<Reply> = {},
): Reply {
  return {
    id: `r-${turnId}-${laneId}`,
    turnId,
    laneId,
    model: { providerId: 'p', modelId: 'm' },
    version: 1,
    active: true,
    status: 'done',
    text,
    steps: [],
    sources: [],
    opts: { reasoning: 'medium', search: 'none' },
    createdAt: 0,
    ...patch,
  }
}

describe('buildMessages', () => {
  it('alternates user and assistant turns', () => {
    const g = makeGraph(
      [turn('t1'), turn('t2', 't1')],
      [reply('t1', 'a', 'a1'), reply('t2', 'a', 'a2')],
      [laneA],
      't2',
    )

    expect(buildMessages(g, laneA)).toEqual([
      { role: 'user', content: 'q-t1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q-t2' },
      { role: 'assistant', content: 'a2' },
    ])
  })

  it('prepends the system prompt when given', () => {
    const g = makeGraph([turn('t1')], [reply('t1', 'a', 'a1')], [laneA], 't1')
    const messages = buildMessages(g, laneA, { system: '  be brief  ' })
    expect(messages[0]).toEqual({ role: 'system', content: 'be brief' })
  })

  it('omits the system prompt when it is blank', () => {
    const g = makeGraph([turn('t1')], [reply('t1', 'a', 'a1')], [laneA], 't1')
    expect(buildMessages(g, laneA, { system: '   ' })[0].role).toBe('user')
  })

  it('excludes failed replies from the history', () => {
    const g = makeGraph(
      [turn('t1'), turn('t2', 't1')],
      [reply('t1', 'a', 'a1'), reply('t2', 'a', 'boom', { status: 'error' })],
      [laneA],
      't2',
    )
    // The failed answer is dropped, and so is the question that produced it —
    // an answer that never arrived must not become an empty assistant turn.
    expect(buildMessages(g, laneA)).toEqual([
      { role: 'user', content: 'q-t1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q-t2' },
    ])
  })

  it('includes a stopped reply, since the partial text is real', () => {
    const g = makeGraph([turn('t1')], [reply('t1', 'a', 'partial', { status: 'stopped' })], [laneA], 't1')
    expect(buildMessages(g, laneA)).toHaveLength(2)
  })

  it('excludes the turn being regenerated', () => {
    const g = makeGraph(
      [turn('t1'), turn('t2', 't1')],
      [reply('t1', 'a', 'a1'), reply('t2', 'a', 'stale')],
      [laneA],
      't2',
    )
    const messages = buildMessages(g, laneA, { excludeTurnId: 't2' })
    expect(messages).toEqual([
      { role: 'user', content: 'q-t1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q-t2' },
    ])
  })

  it('substitutes the ancestor lane’s answers for inherited turns', () => {
    // Lane b was added at t2. For t1 it has no reply, so lane a's stands in.
    const laneB: Lane = { id: 'b', model: { providerId: 'p', modelId: 'm2' }, parentLaneId: 'a' }
    const g = makeGraph(
      [turn('t1'), turn('t2', 't1')],
      [reply('t1', 'a', 'from-a'), reply('t2', 'b', 'from-b')],
      [laneA, laneB],
      't2',
    )

    expect(buildMessages(g, laneB)).toEqual([
      { role: 'user', content: 'q-t1' },
      { role: 'assistant', content: 'from-a' },
      { role: 'user', content: 'q-t2' },
      { role: 'assistant', content: 'from-b' },
    ])
  })

  it('skips replies with no text', () => {
    const g = makeGraph([turn('t1')], [reply('t1', 'a', '   ')], [laneA], 't1')
    expect(buildMessages(g, laneA)).toHaveLength(1)
  })

  it('leaves out, question and all, a turn the lane sat out', () => {
    // The user followed up with lane a only. Lane b must not be handed a
    // question nobody put to it, nor the answer another model gave.
    const laneB: Lane = { id: 'b', model: { providerId: 'p', modelId: 'm2' } }
    const g = makeGraph(
      [turn('t1'), { ...turn('t2', 't1'), skippedLaneIds: ['b'] }, turn('t3', 't2')],
      [reply('t1', 'a', 'a1'), reply('t1', 'b', 'b1'), reply('t2', 'a', 'a2'), reply('t3', 'b', 'b3')],
      [laneA, laneB],
      't3',
    )

    expect(buildMessages(g, laneB)).toEqual([
      { role: 'user', content: 'q-t1' },
      { role: 'assistant', content: 'b1' },
      { role: 'user', content: 'q-t3' },
      { role: 'assistant', content: 'b3' },
    ])
    // The lane that was asked keeps the whole exchange.
    expect(buildMessages(g, laneA).map((message) => message.content)).toEqual(['q-t1', 'a1', 'q-t2', 'a2', 'q-t3'])
  })

  it('carries a parent’s sat-out turn over to a column added later', () => {
    // Lane c branched from b after b sat out t2, so it inherits b's history —
    // which does not include t2.
    const laneB: Lane = { id: 'b', model: { providerId: 'p', modelId: 'm2' } }
    const laneC: Lane = { id: 'c', model: { providerId: 'p', modelId: 'm3' }, parentLaneId: 'b' }
    const g = makeGraph(
      [turn('t1'), { ...turn('t2', 't1'), skippedLaneIds: ['b'] }],
      [reply('t1', 'b', 'b1'), reply('t2', 'a', 'a2')],
      [laneA, laneB, laneC],
      't2',
    )

    expect(buildMessages(g, laneC)).toEqual([
      { role: 'user', content: 'q-t1' },
      { role: 'assistant', content: 'b1' },
    ])
  })
})

describe('coalesceRoles', () => {
  it('joins consecutive same-role messages', () => {
    const merged = coalesceRoles([
      { role: 'user', content: 'one' },
      { role: 'user', content: 'two' },
    ])
    expect(merged).toEqual([{ role: 'user', content: 'one\n\ntwo' }])
  })

  it('leaves alternating messages alone', () => {
    const input = [
      { role: 'user' as const, content: 'q' },
      { role: 'assistant' as const, content: 'a' },
    ]
    expect(coalesceRoles(input)).toEqual(input)
  })

  it('does not merge system messages into each other', () => {
    const merged = coalesceRoles([
      { role: 'system', content: 's1' },
      { role: 'system', content: 's2' },
    ])
    expect(merged).toHaveLength(2)
  })
})

describe('titlePrompt', () => {
  it('collapses whitespace and truncates a long message', () => {
    const { prompt } = titlePrompt(`line one\n\n   line two ${'x'.repeat(600)}`)
    const body = prompt.slice(prompt.indexOf('<message>\n') + '<message>\n'.length, prompt.indexOf('\n</message>'))
    expect(body.startsWith('line one line two')).toBe(true)
    expect(body.length).toBeLessThanOrEqual(400)
  })

  it('keeps the instructions out of the message list', () => {
    const { instructions } = titlePrompt('hi')
    expect(instructions).toMatch(/title/i)
  })
})

describe('cleanTitle', () => {
  it('strips quotes, labels and trailing punctuation', () => {
    expect(cleanTitle('「快速排序实现」。')).toBe('快速排序实现')
    expect(cleanTitle('标题：快速排序')).toBe('快速排序')
    expect(cleanTitle('"Quick sort"\nMore text')).toBe('Quick sort')
  })
})

describe('fallbackTitle', () => {
  it('keeps short messages and truncates long ones', () => {
    expect(fallbackTitle('帮我写一个  快速排序')).toBe('帮我写一个 快速排序')
    expect(fallbackTitle('一'.repeat(30))).toBe(`${'一'.repeat(20)}…`)
  })
})

describe('userContent', () => {
  const file = (name: string, text?: string) => ({
    id: `a-${name}`,
    name,
    ext: 'md',
    mime: 'text/markdown',
    bytes: 10,
    text,
  })

  it('returns the bare question when nothing is attached', () => {
    expect(userContent('问题', [])).toBe('问题')
    expect(userContent('问题', [file('x.md')])).toBe('问题')
  })

  it('wraps attached text in a named block', () => {
    const content = userContent('看看这个', [file('notes.md', '# 笔记')]) as string
    expect(content).toContain('<file name="notes.md">')
    expect(content).toContain('# 笔记')
    expect(content.startsWith('看看这个')).toBe(true)
  })

  it('does not open with a blank line when the send is the file alone', () => {
    const content = userContent('', [file('notes.md', '# 笔记')]) as string
    expect(content.startsWith('以下是随消息附上的文件内容：')).toBe(true)
  })

  it('truncates to the budget and says so', () => {
    const content = userContent('q', [file('big.md', 'x'.repeat(500))], { maxChars: 100 }) as string
    expect(content).toContain('已截断')
    expect(content.length).toBeLessThan(300)
  })

  it('always sends a PDF as text, never as a file part', () => {
    // The text was already extracted on the user's machine, so a document part
    // would duplicate it at many times the token cost — and would fail on the
    // compatible endpoints that cannot carry a document at all.
    const pdf = {
      id: 'a-2',
      name: 'report.pdf',
      ext: 'pdf',
      mime: 'application/pdf',
      bytes: 20,
      text: '第三章 结论',
      dataUrl: 'data:application/pdf;base64,AAAA',
    }

    // A plain string: no image part is produced, so there is nothing that needs
    // the multipart shape.
    const content = userContent('看这个', [pdf], { vision: true })
    expect(typeof content).toBe('string')
    expect(content).toContain('第三章 结论')
    expect(content).toContain('<file name="report.pdf">')
  })

  it('sends an image as a file part only when the model can see', () => {
    const image = {
      id: 'a-1',
      name: 'shot.png',
      ext: 'png',
      mime: 'image/png',
      bytes: 10,
      dataUrl: 'data:image/png;base64,AAAA',
    }

    const withoutVision = userContent('看这个', [image]) as string
    expect(typeof withoutVision).toBe('string')

    const parts = userContent('看这个', [image], { vision: true }) as Array<{ type: string }>
    expect(parts.map((part) => part.type)).toEqual(['text', 'image'])
  })
})

describe('systemPrompt', () => {
  // East of Greenwich, so local midnight and UTC fall on different days.
  const zone = process.env.TZ
  beforeAll(() => {
    process.env.TZ = 'Asia/Shanghai'
  })
  afterAll(() => {
    process.env.TZ = zone
  })

  it('dates the prompt by the local day, not the UTC one', () => {
    // 00:30 on the 13th in Shanghai is still the 12th in UTC.
    const prompt = systemPrompt(undefined, new Date(Date.UTC(2026, 9, 12, 16, 30)))
    expect(prompt).toBe('Today is 2026-10-13 (Tuesday), time zone Asia/Shanghai.')
  })

  it('keeps the custom instructions after the date, and drops blank ones', () => {
    const now = new Date(Date.UTC(2026, 9, 13, 4, 0))
    expect(systemPrompt('  先给结论  ', now)).toBe(
      'Today is 2026-10-13 (Tuesday), time zone Asia/Shanghai.\n\n先给结论',
    )
    expect(systemPrompt('   ', now)).toBe('Today is 2026-10-13 (Tuesday), time zone Asia/Shanghai.')
  })
})
