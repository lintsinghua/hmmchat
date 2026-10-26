import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, Maximize2 } from 'lucide-react'
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom'

import {
  activePath,
  activeReply,
  laneSkipped,
  replyFor,
  replyVersions,
  siblingTurns,
  visibleLanes,
  type ConversationGraph,
  type Lane,
  type Turn,
} from '@/chat/types'
import {
  editTurn,
  forkFromTurn,
  moveLane,
  regenerate,
  selectBranch,
  selectReplyVersion,
  stopLane,
} from '@/chat/session'
import { useStore } from '@/chat/store'
import { displayName } from '@/providers/registry'
import { ModelIcon } from '@/components/icons/BrandIcon'
import { useElementWidth } from '@/hooks/useElementWidth'
import { useLaneReorder } from '@/hooks/useLaneReorder'
import { cn } from '@/lib/cn'
import { ReplyView } from '@/components/message/ReplyView'
import { useT } from '@/i18n/core'
import { thread } from '@/i18n'
import { UserMessage } from '@/components/message/UserMessage'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'

/**
 * The transcript.
 *
 * One turn renders as: the user's question, then **one reply per visible lane**.
 * With one lane that is an ordinary chat; with two to four it is a row of equal
 * columns. There is no separate "compare mode" branch — the lane count decides
 * the layout, which is what keeps the two modes from drifting apart.
 */

/** Below this per-column width, real columns stop being readable. */
const MIN_COLUMN_WIDTH = 320
/** A column that sat out a turn keeps its place at this width. */
const SKIPPED_COLUMN_WIDTH = 104

export function Thread({ graph }: { graph: ConversationGraph }) {
  const turns = useMemo(() => activePath(graph), [graph])
  const visible = visibleLanes(graph.conversation.lanes)
  const focusedLaneId = useStore((state) => state.focusedLaneId)
  const setFocusedLane = useStore((state) => state.setFocusedLane)
  const focused = visible.length > 1 ? visible.find((lane) => lane.id === focusedLaneId) : undefined
  // Focused, the thread is that model's own conversation: one column, at the
  // single-column measure, with no compare chrome.
  const lanes = focused ? [focused] : visible

  // What the focused model saw. Turns it sat out were never part of its
  // conversation (context.ts leaves them out whole), so they fold into a quiet
  // marker rather than appearing as questions it did not answer.
  const rows = useMemo(() => {
    if (!focused) return turns.map((turn) => ({ turn, sat: 0 }))
    const out: Array<{ turn: Turn; sat: number } | { turn: null; sat: number }> = []
    for (const turn of turns) {
      if (!laneSkipped(graph, turn, focused)) out.push({ turn, sat: 0 })
      else if (out.at(-1)?.turn === null) out.at(-1)!.sat += 1
      else out.push({ turn: null, sat: 1 })
    }
    return out
  }, [graph, turns, focused])

  return (
    <StickToBottom
      className="relative min-h-0 flex-1"
      // `instant` rather than a spring: a bouncy scroll fights the smoother when
      // text arrives in bursts, and the thread visibly rocks while streaming.
      resize="instant"
      initial="instant"
    >
      {/*
        880px is a reading measure for one column. Compare lanes carry their own
        measure (MIN_COLUMN_WIDTH), so capping the row at 880 left room for only
        two of them and pushed three or four lanes into tabs at any window size.
        Keyed on the focus so entering or leaving it is one short fade, not a
        reflow of columns collapsing in place.

        The key also replaces the scroller, and the library makes its scroller
        scrollable with an inline style once, on first mount — so after a focus
        change the new one came up `overflow: visible`, clipped by the shell.
        Nothing past the first screen could be reached, a question sent from
        there vanished below the fold, and 回到底部 did nothing. `overflow-auto`
        (both axes: the library's wheel handling matches the shorthand) holds
        for every remount.
      */}
      <StickToBottom.Content
        key={focused?.id ?? 'all'}
        scrollClassName="overflow-auto"
        className={cn(
          'mx-auto flex w-full flex-col gap-8 px-6 pb-8 pt-4 animate-fade-in max-md:gap-7 max-md:px-4 max-md:pt-2',
          lanes.length > 1 ? null : 'max-w-[880px]',
        )}
        style={lanes.length > 1 ? { maxWidth: lanes.length * 560 } : undefined}
      >
        {rows.map((row, index) =>
          row.turn ? (
            <TurnBlock key={row.turn.id} graph={graph} turn={row.turn} lanes={lanes} onFocus={setFocusedLane} />
          ) : (
            <SatOut key={`sat-${index}`} lane={focused!} rounds={row.sat} />
          ),
        )}
      </StickToBottom.Content>
      <ScrollToBottomButton />
      <FollowNewTurns graph={graph} last={turns.at(-1)?.id} />
    </StickToBottom>
  )
}

/** Stands in, in a focused thread, for rounds the focused model was not asked. */
function SatOut({ lane, rounds }: { lane: Lane; rounds: number }) {
  const t = useT()
  return (
    <div
      className="flex items-center gap-3 text-[12px] text-ink-faint"
      title={t(thread.satOutTitle, { count: rounds, model: displayName(lane.model.modelId) })}
    >
      <span className="h-px flex-1 bg-line" />
      <span className="whitespace-nowrap">{t(thread.satOutRounds, { count: rounds })}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  )
}

function TurnBlock({
  graph,
  turn,
  lanes,
  onFocus,
}: {
  graph: ConversationGraph
  turn: Turn
  lanes: Lane[]
  onFocus: (laneId: string) => void
}) {
  const [measureRef, width] = useElementWidth<HTMLDivElement>()
  const [activeLaneId, setActiveLaneId] = useState<string | null>(null)
  const draggingLaneId = useStore((state) => state.draggingLaneId)
  const setDraggingLane = useStore((state) => state.setDraggingLane)

  const siblings = siblingTurns(graph, turn)
  const siblingIndex = siblings.findIndex((entry) => entry.id === turn.id)

  // Columns that sat out this turn stay in place but collapse to a strip, so
  // the grid does not shift between turns and the answering columns get the
  // room. Tabs, when the answers need them, list only the columns that answered.
  const skipped = new Set(lanes.filter((lane) => laneSkipped(graph, turn, lane)).map((lane) => lane.id))
  const answering = lanes.filter((lane) => !skipped.has(lane.id))
  const activeTab = useMemo(() => {
    const found = activeLaneId ? answering.findIndex((lane) => lane.id === activeLaneId) : -1
    return found >= 0 ? found : 0
  }, [activeLaneId, answering])

  // Columns give way to tabs once each would be too narrow to read a paragraph
  // in. That threshold is a reading-measure decision, not a pixel-fitting one.
  const perColumn = (width - skipped.size * SKIPPED_COLUMN_WIDTH) / Math.max(1, answering.length)
  const useTabs = answering.length > 1 && width > 0 && perColumn < MIN_COLUMN_WIDTH
  const shown = useTabs ? [answering[Math.min(activeTab, answering.length - 1)]] : lanes
  // On a phone the tabs are the comparison, and a sideways swipe across the
  // answer moves to the next model's, like paging.
  const swipe = useSwipeTabs((step) => {
    const next = activeTab + step
    if (next >= 0 && next < answering.length) setActiveLaneId(answering[next].id)
  })

  const {
    containerRef: gridRef,
    draggingId: draggingColumnId,
    getItemProps: getColumnProps,
  } = useLaneReorder<HTMLDivElement>({
    enabled: !useTabs && shown.length > 1,
    requireHandle: true,
    onMove: (fromId, toId) => void moveLane(fromId, toId),
    onDragChange: setDraggingLane,
  })

  return (
    <div ref={measureRef} data-turn={turn.id} className="flex flex-col gap-4">
      <UserMessage
        turn={turn}
        onEdit={(text) => void editTurn(turn.id, text)}
        siblingInfo={
          siblings.length > 1
            ? {
                index: siblingIndex,
                total: siblings.length,
                ids: siblings.map((entry) => entry.id),
                onSelect: (id) => void selectBranch(id),
              }
            : undefined
        }
      />

      {useTabs ? (
        <LaneTabs
          lanes={answering}
          active={activeTab}
          onChange={(index) => setActiveLaneId(answering[index]?.id ?? null)}
          onFocus={onFocus}
        />
      ) : null}

      <div
        ref={gridRef}
        {...(useTabs ? swipe : {})}
        className="grid gap-x-6 gap-y-6"
        style={
          shown.length > 1
            ? {
                gridTemplateColumns: shown
                  .map((lane) => (skipped.has(lane.id) ? `${SKIPPED_COLUMN_WIDTH}px` : 'minmax(0, 1fr)'))
                  .join(' '),
              }
            : undefined
        }
      >
        {shown.map((lane, index) => {
          const isPointerDragging = shown.length > 1 && draggingColumnId === lane.id
          const isSyncedDragging =
            shown.length > 1 && !isPointerDragging && draggingLaneId === lane.id
          return (
            <div
              key={lane.id}
              {...(shown.length > 1 ? getColumnProps(lane.id) : {})}
              className={cn(
                'min-w-0 rounded-[var(--radius-sm)] transition-[background-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
                isPointerDragging &&
                  'bg-canvas/95 shadow-[var(--shadow-overlay)] outline outline-1 outline-offset-4 outline-line-strong backdrop-blur-[2px]',
                isSyncedDragging &&
                  'bg-surface/60 outline outline-1 outline-offset-4 outline-line',
              )}
            >
              {!useTabs && skipped.has(lane.id) ? (
                <SkippedColumn lane={lane} canReorder={shown.length > 1} />
              ) : (
                <LaneColumn
                  graph={graph}
                  turn={turn}
                  lane={lane}
                  laneCount={shown.length}
                  laneIndex={shown.length > 1 ? index : 0}
                  // Compare mode trades type size for the ability to see both answers
                  // at once, which is the whole point of the layout.
                  compact={shown.length - skipped.size > 1}
                  onFocus={lanes.length > 1 ? () => onFocus(lane.id) : undefined}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * A column that was not asked this turn.
 *
 * Kept as a narrow strip rather than removed, so each model stays in the same
 * column from one turn to the next and it is plain at a glance who answered.
 */
function SkippedColumn({ lane, canReorder }: { lane: Lane; canReorder?: boolean }) {
  const t = useT()
  return (
    <div
      data-lane-handle={canReorder ? lane.id : undefined}
      className={cn(
        'flex h-full min-w-0 items-start gap-1.5 border-l border-dashed border-line-strong pl-3 pt-1 text-[12px] text-ink-faint',
        canReorder && 'cursor-grab select-none active:cursor-grabbing',
      )}
      title={t(thread.skippedTitle, { model: displayName(lane.model.modelId) })}
    >
      <ModelIcon modelId={lane.model.modelId} className="mt-[1px] h-3.5 w-3.5 shrink-0 opacity-50 grayscale" />
      <span className="whitespace-nowrap">{t(thread.skipped)}</span>
    </div>
  )
}

function LaneColumn({
  graph,
  turn,
  lane,
  laneCount,
  laneIndex,
  compact,
  onFocus,
}: {
  graph: ConversationGraph
  turn: Turn
  lane: Lane
  laneCount: number
  laneIndex: number
  compact: boolean
  /** Shows this column on its own; absent when it already is the only one. */
  onFocus?: () => void
}) {
  // `replyFor` walks up the lane chain, so a column added mid-conversation shows
  // the answer it actually inherited rather than an empty gutter. That matters
  // twice over: the model was given that answer as context, so hiding it made
  // the column look like it had answered from nothing; and the user's next move
  // — "answer this one yourself" — is only obvious once they can see what "this
  // one" was.
  const reply = activeReply(graph, turn.id, lane.id) ?? replyFor(graph, turn.id, lane)
  const inherited = reply && reply.laneId !== lane.id

  if (!reply) {
    // No answer and nothing to inherit: this lane was added after the turn and
    // descends from nothing that answered it either.
    return (
      <div
        data-lane-handle={laneCount > 1 ? lane.id : undefined}
        className={cn(
          'select-none pt-1 text-[13px] text-ink-faint',
          laneCount > 1 && 'cursor-grab active:cursor-grabbing',
        )}
        aria-hidden
      >
        —
      </div>
    )
  }

  const versions = replyVersions(graph, turn.id, lane.id)

  return (
    <ReplyView
      reply={reply}
      lane={lane}
      compact={compact}
      laneIndex={laneIndex}
      laneCount={laneCount}
      inheritedFrom={
        inherited ? graph.conversation.lanes.find((entry) => entry.id === reply.laneId) : undefined
      }
      onFocus={onFocus}
      onRegenerate={() => void regenerate(turn.id, lane.id)}
      onFork={() => void forkFromTurn(turn.id)}
      onStop={() => stopLane(lane.id)}
      versions={versions.length > 1 ? versions : undefined}
      onSelectVersion={(replyId) => void selectReplyVersion(turn.id, lane.id, replyId)}
    />
  )
}

/**
 * Column switcher for narrow windows.
 *
 * A sliding underline rather than a filled pill: it reads as a position within
 * a sequence, which is what tabs are. The trailing control shows the selected
 * column on its own — the narrow-window counterpart of a column header's.
 */
function LaneTabs({
  lanes,
  active,
  onChange,
  onFocus,
}: {
  lanes: Lane[]
  active: number
  onChange: (index: number) => void
  onFocus: (laneId: string) => void
}) {
  const t = useT()
  const draggingLaneId = useStore((state) => state.draggingLaneId)
  const setDraggingLane = useStore((state) => state.setDraggingLane)
  const { containerRef: tabsRef, getItemProps: getTabProps } = useLaneReorder<HTMLDivElement>({
    enabled: lanes.length > 1,
    onMove: (fromId, toId) => void moveLane(fromId, toId),
    onDragChange: setDraggingLane,
  })
  const current = lanes[Math.min(active, lanes.length - 1)]
  const viewAlone = t(thread.viewAlone, { model: displayName(current.model.modelId) })
  return (
    <div className="flex items-center gap-1 border-b border-line pb-2">
      {/* Scrolls sideways when four model names are wider than a phone. */}
      <div ref={tabsRef} className="no-scrollbar -mb-[10px] flex min-w-0 flex-1 items-center gap-1 overflow-x-auto pb-[10px]">
        {lanes.map((lane, index) => (
          <button
            key={lane.id}
            type="button"
            {...(lanes.length > 1 ? getTabProps(lane.id) : {})}
            onClick={() => onChange(index)}
            className={cn(
              'relative flex shrink-0 items-center gap-1.5 rounded-[6px] px-2 py-1 text-[12.5px] font-medium',
              'touch:px-2.5 touch:py-1.5 touch:text-[13.5px]',
              'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
              lanes.length > 1 && 'cursor-grab select-none active:cursor-grabbing',
              active === index ? 'text-ink' : 'text-ink-muted hover:text-ink-soft',
              draggingLaneId === lane.id &&
                'bg-paper text-ink shadow-[var(--shadow-raised)] ring-1 ring-inset ring-line-strong',
            )}
          >
            <ModelIcon modelId={lane.model.modelId} className="h-3.5 w-3.5" />
            {displayName(lane.model.modelId)}
            {active === index ? (
              <span className="absolute inset-x-1.5 -bottom-[9px] h-[1.5px] rounded-full bg-ink" />
            ) : null}
          </button>
        ))}
      </div>
      <Tooltip label={viewAlone}>
        <Button
          size="icon-sm"
          className="ml-auto"
          onClick={() => onFocus(current.id)}
          aria-label={viewAlone}
        >
          <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Button>
      </Tooltip>
    </div>
  )
}

/**
 * A horizontal swipe, read from touch events on the element it is spread on.
 *
 * Mostly-sideways and long enough to be deliberate, so reading down an answer
 * never flips the tab. A swipe that starts inside something that scrolls
 * sideways of its own — a code block, a wide table, a formula — is that
 * element's, not the tabs'.
 */
function useSwipeTabs(onStep: (step: 1 | -1) => void) {
  const start = useRef<{ x: number; y: number } | null>(null)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep

  return useMemo(
    () => ({
      onTouchStart: (event: React.TouchEvent) => {
        const touch = event.touches[0]
        const scroller = (event.target as HTMLElement).closest?.('pre, [data-streamdown="table-wrapper"], .katex-display')
        // The left edge is the drawer's swipe.
        const edge = touch.clientX <= 32
        start.current =
          event.touches.length === 1 && !scroller && !edge ? { x: touch.clientX, y: touch.clientY } : null
      },
      onTouchEnd: (event: React.TouchEvent) => {
        const from = start.current
        start.current = null
        const touch = event.changedTouches[0]
        if (!from || !touch) return
        const dx = touch.clientX - from.x
        const dy = touch.clientY - from.y
        if (Math.abs(dx) < 64 || Math.abs(dx) < Math.abs(dy) * 2) return
        onStepRef.current(dx < 0 ? 1 : -1)
      },
    }),
    [],
  )
}

/** Appears only once the user has scrolled away from the end of the thread. */
function ScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext()
  const t = useT()

  return (
    <button
      type="button"
      onClick={() => void scrollToBottom()}
      aria-label={t(thread.scrollToBottom)}
      className={cn(
        'absolute bottom-4 left-1/2 z-10 flex h-8 w-8 -translate-x-1/2 items-center justify-center rounded-full',
        'border border-line bg-paper shadow-[var(--shadow-raised)] text-ink-soft',
        'transition-[opacity,transform] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
        'hover:text-ink active:scale-95',
        isAtBottom ? 'pointer-events-none scale-90 opacity-0' : 'scale-100 opacity-100',
      )}
    >
      <ArrowDown className="h-4 w-4" strokeWidth={1.75} />
    </button>
  )
}

/**
 * Brings a question the user has just sent into view.
 *
 * The thread follows new output only while the reader is at the bottom, so
 * reading back up through a long answer is never yanked away. A fresh question
 * is different: the user is waiting on it. Without this, a send made after
 * scrolling up — the usual moment to focus a column, from its header — landed
 * below the fold, and the message looked lost while its answer streamed out of
 * sight. Only turns this conversation has never had count; switching to an
 * existing branch stays where the reader is.
 */
function FollowNewTurns({ graph, last }: { graph: ConversationGraph; last: string | undefined }) {
  const { scrollToBottom } = useStickToBottomContext()
  // Null until the first render, whose position is the initial scroll's job.
  const known = useRef<Set<string> | null>(null)

  useEffect(() => {
    const fresh = last !== undefined && known.current !== null && !known.current.has(last)
    known.current ??= new Set()
    for (const turn of graph.turns) known.current.add(turn.id)
    // Instant, like the thread's other scrolls: a long spring from the top of a
    // four-column answer outlasts every other motion in the app.
    if (fresh) void scrollToBottom('instant')
  }, [graph, last, scrollToBottom])

  return null
}
