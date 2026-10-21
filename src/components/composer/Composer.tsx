import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  Columns2,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  MessageSquareQuote,
  Paperclip,
  Plus,
  RotateCcw,
  Square,
  X,
} from 'lucide-react'

import { useStore } from '@/chat/store'
import {
  addLane,
  MAX_LANES,
  moveLane,
  newConversationModels,
  removeLane,
  restoreLane,
  sendMessage,
  sendTargets,
  stopTurn,
  switchLaneModel,
} from '@/chat/session'
import { useLaneReorder } from '@/hooks/useLaneReorder'
import {
  laneAnswerCount,
  visibleLanes,
  type Attachment,
  type Lane,
  type ReasoningLevel,
  type SearchMode,
} from '@/chat/types'
import { displayName } from '@/providers/registry'
import { availableLevels, effectiveLevel, hasDepthChoice, REASONING_LABELS } from '@/providers/reasoning'
import { capabilitiesFor, reasoningNoteFor } from '@/providers/registry'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Tooltip } from '@/components/ui/Tooltip'
import {
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverLabel,
  PopoverSeparator,
  PopoverTrigger,
} from '@/components/ui/Popover'
import { ModelPicker, useAvailableModels } from '@/components/model/ModelPicker'
import {
  formatBytes,
  hasNativeInput,
  isImage as isImageExt,
  isSupported,
  readAttachment,
} from '@/lib/attachments'
import { BrandIcon, ModelIcon } from '@/components/icons/BrandIcon'
import { t, useT } from '@/i18n/core'
import { composer } from '@/i18n'
import { ReferencePicker } from './ReferencePicker'

/**
 * The composer — the app's only control surface.
 *
 * The model chip, the search toggle, the reasoning level and the send button all
 * live here rather than in a toolbar or a right-hand panel. Each is a quiet text
 * control that only shows a background on hover, so the resting state reads as a
 * sentence and a button rather than as an instrument panel.
 */

/** Grows to this height, then scrolls. */
const MAX_TEXTAREA_HEIGHT = 200

export function Composer({
  onSent,
  stopShortcut = 'Esc',
}: {
  onSent?: () => void
  /** The user's binding for stop, so the tooltip matches what fires. */
  stopShortcut?: string
}) {
  const t = useT()
  const graph = useStore((state) => state.graph)
  const providers = useStore((state) => state.providers)
  const composerModel = useStore((state) => state.composerModel)
  const composerReasoning = useStore((state) => state.composerReasoning)
  const composerSearch = useStore((state) => state.composerSearch)
  const running = useStore((state) => state.running)

  const setComposerModel = useStore((state) => state.setComposerModel)
  const setComposerReasoning = useStore((state) => state.setComposerReasoning)
  const laneReasoning = useStore((state) => state.laneReasoning)
  const setLaneReasoning = useStore((state) => state.setLaneReasoning)
  const excludedLaneIds = useStore((state) => state.excludedLaneIds)
  const toggleLaneExcluded = useStore((state) => state.toggleLaneExcluded)
  const includeAllLanes = useStore((state) => state.includeAllLanes)
  const focusedLaneId = useStore((state) => state.focusedLaneId)
  const setFocusedLane = useStore((state) => state.setFocusedLane)
  const draggingLaneId = useStore((state) => state.draggingLaneId)
  const setDraggingLane = useStore((state) => state.setDraggingLane)
  const referencePicker = useStore((state) => state.referencePicker)
  const setReferencePicker = useStore((state) => state.setReferencePicker)
  const setComposerSearch = useStore((state) => state.setComposerSearch)

  const [value, setValue] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [reading, setReading] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [addOpen, setAddOpen] = useState(false)
  // Where an "@" was taken out to open the quote picker, so cancelling can put
  // it back: someone typing an address or a handle should not lose the symbol.
  const atRef = useRef<number | null>(null)

  const lanes = graph ? visibleLanes(graph.conversation.lanes) : []
  const isRunning = running.length > 0
  // The column shown on its own, if any. Focused, the composer talks to that
  // column alone and shows only its chip; the others are kept, not removed.
  const focused = lanes.length > 1 ? lanes.find((lane) => lane.id === focusedLaneId) : undefined
  // Which columns the next message goes to. Narrowed means the user is talking
  // to only some of the compared models; the rule is `sendTargets`, the same one
  // the send uses, so what the chips show is what will happen.
  const targets = sendTargets(lanes, excludedLaneIds, focused?.id ?? null)
  const narrowed = !focused && lanes.length > 1 && targets.length < lanes.length

  // A column just removed, offered back for a few seconds right where its chip
  // was. Later, the compare menu lists it under 已移除.
  const [justRemoved, setJustRemoved] = useState<Lane | null>(null)
  useEffect(() => {
    if (!justRemoved) return
    const timer = window.setTimeout(() => setJustRemoved(null), 6000)
    return () => window.clearTimeout(timer)
  }, [justRemoved])
  const conversationId = graph?.conversation.id
  useEffect(() => setJustRemoved(null), [conversationId])

  // Removed columns that still hold answers of their own.
  const removed = useMemo(() => {
    if (!graph) return []
    const shown = visibleLanes(graph.conversation.lanes)
    return graph.conversation.lanes
      .filter((lane) => lane.hidden)
      .map((lane) => ({
        lane,
        answers: laneAnswerCount(graph, lane),
        // One column per model: a removed GPT-5 cannot come back beside a
        // visible one.
        duplicate: shown.some(
          (entry) => entry.model.providerId === lane.model.providerId && entry.model.modelId === lane.model.modelId,
        ),
      }))
      .filter((entry) => entry.answers > 0)
  }, [graph])

  // With no conversation open, the chips show what a first send would create:
  // the chosen model (else the default, else the first enabled one) and the
  // default comparison models — so the composer's controls describe something
  // real and the first Enter answers in the columns on screen.
  const settings = useStore((state) => state.settings)
  const drafts = useMemo(
    () => (graph ? [] : newConversationModels(providers, settings, [composerModel, settings.defaultModel])),
    [graph, providers, settings, composerModel],
  )

  const activeModel = focused?.model ?? composerModel ?? lanes[0]?.model ?? drafts[0] ?? null
  const provider = providers.find((entry) => entry.id === activeModel?.providerId)
  const capabilities =
    provider && activeModel
      ? capabilitiesFor(provider, activeModel.modelId)
      : {
          thinking: 'none' as const,
          reasoning: [],
          tools: false,
          nativeSearch: false,
          vision: false,
          pdf: false,
        }

  // The levels come from the model's own accepted values, not its provider, and
  // a model with only one possible depth gets no control at all.
  const levels = hasDepthChoice(capabilities.thinking, capabilities.reasoning)
    ? availableLevels(capabilities.thinking, capabilities.reasoning)
    : []
  // Set when the model necessarily reasons but the endpoint takes no depth
  // parameter — the control is hidden, and this is the reason why.
  const reasoningNote = provider && activeModel ? reasoningNoteFor(provider, activeModel.modelId) : null

  /**
   * What the model chips render.
   *
   * Each visible lane is one chip carrying its lane id, so selecting a model on
   * it can retarget that specific column. With no conversation yet there are no
   * lanes, so draft chips stand in — not persisted, but enough to keep the
   * composer honest about which models are about to answer.
   */
  const chips = useMemo(() => {
    if (focused) return [{ id: focused.id, laneId: focused.id, model: focused.model }]
    if (lanes.length) return lanes.map((lane) => ({ id: lane.id, laneId: lane.id, model: lane.model }))
    return drafts.map((model) => ({
      id: `draft-${model.providerId}:${model.modelId}`,
      laneId: null as string | null,
      model,
    }))
  }, [focused, lanes, drafts])

  const reorderChips = useCallback(
    (fromId: string, toId: string) => {
      if (lanes.length > 1) {
        void moveLane(fromId, toId)
        return
      }
      const fromIndex = drafts.findIndex((model) => `draft-${model.providerId}:${model.modelId}` === fromId)
      const toIndex = drafts.findIndex((model) => `draft-${model.providerId}:${model.modelId}` === toId)
      if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return
      const next = [...drafts]
      const [moved] = next.splice(fromIndex, 1)
      next.splice(toIndex, 0, moved)
      setComposerModel(next[0])
      useStore.getState().setSettings({
        ...(settings.defaultModel ? { defaultModel: next[0] } : {}),
        defaultCompareModels: next.slice(1),
      })
    },
    [lanes.length, drafts, setComposerModel, settings.defaultModel],
  )

  const {
    containerRef: chipsRef,
    draggingId: draggingChipId,
    getItemProps: getChipProps,
  } = useLaneReorder<HTMLDivElement>({
    enabled: chips.length > 1,
    onMove: reorderChips,
    onDragChange: setDraggingLane,
  })

  /**
   * Each column's own depth control. Computed per lane rather than from the
   * active model, because in compare mode the columns are different models
   * with different vocabularies — a GPT accepting `xhigh` beside a toggle-only
   * DeepSeek — and a shared control could only offer what they have in common.
   */
  const laneDepths = useMemo(
    () =>
      chips.map((chip) => {
        const provider = providers.find((entry) => entry.id === chip.model.providerId)
        const caps = provider ? capabilitiesFor(provider, chip.model.modelId) : null
        return {
          id: chip.id,
          laneId: chip.laneId,
          model: chip.model,
          levels:
            caps && hasDepthChoice(caps.thinking, caps.reasoning)
              ? availableLevels(caps.thinking, caps.reasoning)
              : [],
          note: provider ? reasoningNoteFor(provider, chip.model.modelId) : null,
          value: (chip.laneId && laneReasoning[chip.laneId]) || composerReasoning,
        }
      }),
    [chips, providers, laneReasoning, composerReasoning],
  )

  // Auto-grow: reset to auto first so the textarea can shrink again when text
  // is deleted, then clamp to the maximum.
  const resize = useCallback(() => {
    const node = textareaRef.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, MAX_TEXTAREA_HEIGHT)}px`
  }, [])

  useEffect(resize, [value, resize])

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = [...files]
    if (!list.length) return

    // Filter before reading: a drag of a whole folder lands here, and quietly
    // attaching nothing looks like the app ignored the drop.
    const supported = list.filter((file) => isSupported(file.name))
    const skipped = list.length - supported.length
    setAttachError(
      skipped
        ? t(skipped === 1 ? composer.skippedUnsupportedOne : composer.skippedUnsupported, { count: skipped })
        : null,
    )
    if (!supported.length) return

    setReading(true)
    try {
      const reads = await Promise.all(supported.map((file) => readAttachment(file)))
      setAttachments((previous) => [...previous, ...reads])
    } finally {
      setReading(false)
    }
  }, [t])

  const attachFromPicker = useCallback(async () => {
    const node = fileInputRef.current
    if (!node) return
    node.click()
  }, [])

  const submit = useCallback(() => {
    const text = value.trim()
    // A file with no message is a legitimate send: "read this".
    if ((!text && !attachments.length) || isRunning) return

    // With no conversation yet, adopt the first draft as the displayed choice
    // so the conversation `sendMessage` creates leads with the model the chip
    // shows. Everything else is read from the composer at send time.
    if (!graph && drafts[0] && !composerModel) setComposerModel(drafts[0])

    setValue('')
    setAttachments([])
    void sendMessage(text, attachments)
    onSent?.()
  }, [value, attachments, isRunning, onSent, graph, drafts, composerModel, setComposerModel])

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME guard. On WebKit, confirming a candidate with Enter reports
    // `isComposing === false` but leaves `keyCode === 229`, so checking only
    // `isComposing` lets a candidate-selection Enter send the message — the
    // single most annoying bug possible in a Chinese chat app. Both are checked.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return

    // Esc leaves a focused column, then widens a narrowed send back to every
    // column. While something is streaming, Esc is the stop shortcut and is
    // left to it.
    if (event.key === 'Escape' && (focused || narrowed) && !isRunning) {
      event.preventDefault()
      if (focused) setFocusedLane(null)
      else includeAllLanes()
      return
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.metaKey) {
      event.preventDefault()
      submit()
      return
    }

    // ⌘Enter and Shift+Enter both insert a newline.
    if (event.key === 'Enter' && (event.metaKey || event.shiftKey)) {
      event.preventDefault()
      const node = event.currentTarget
      const { selectionStart, selectionEnd } = node
      const next = `${value.slice(0, selectionStart)}\n${value.slice(selectionEnd)}`
      setValue(next)
      requestAnimationFrame(() => {
        node.selectionStart = node.selectionEnd = selectionStart + 1
      })
    }
  }

  return (
    <div className="pointer-events-none sticky bottom-0 z-10 px-6 pb-5">
      <div className="pointer-events-auto relative mx-auto w-full max-w-[880px]">
        {/*
          Removal is undoable in place: a small notice over the composer says
          which column went and offers it back, then quietly leaves. Above the
          card rather than in the chip row, which can already be full and would
          push it out of sight. The answers are never lost either way — the
          compare menu keeps the column under 已移除 after this fades.
        */}
        {justRemoved && !focused ? (
          <div className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2">
            <button
              type="button"
              onClick={() => {
                void restoreLane(justRemoved.id)
                setJustRemoved(null)
              }}
              title={t(composer.restoreModelTitle, { model: displayName(justRemoved.model.modelId) })}
              className={cn(
                'animate-rise-in flex h-8 items-center gap-1.5 rounded-full border border-line bg-paper px-3',
                'text-[12.5px] text-ink-muted shadow-[var(--shadow-raised)]',
                'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)] hover:text-ink',
              )}
            >
              <ModelIcon modelId={justRemoved.model.modelId} className="h-3.5 w-3.5 opacity-60 grayscale" />
              <span className="whitespace-nowrap">
                {t(composer.removedModel, { model: displayName(justRemoved.model.modelId) })}
              </span>
              <span className="text-ink-faint">·</span>
              <span className="flex items-center gap-1 whitespace-nowrap font-medium text-ink-soft">
                <RotateCcw className="h-3 w-3" strokeWidth={2} />
                {t(composer.undo)}
              </span>
            </button>
          </div>
        ) : null}
        <div
          onDragOver={(event) => {
            if (event.dataTransfer && !event.dataTransfer.types.includes('Files')) return
            // Without preventDefault the browser navigates to the dropped file.
            event.preventDefault()
            if (!dragging) setDragging(true)
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) return
            setDragging(false)
          }}
          onDrop={(event) => {
            event.preventDefault()
            setDragging(false)
            if (event.dataTransfer?.files?.length) void addFiles(event.dataTransfer.files)
          }}
          className={cn(
            'rounded-[var(--radius-lg)] border bg-paper',
            'shadow-[var(--shadow-raised)]',
            'transition-[border-color,box-shadow] duration-[var(--dur-fast)] ease-[var(--ease-out)]',
            dragging ? 'border-line-strong' : 'border-line',
            'focus-within:border-line-strong',
          )}
        >
          {attachments.length ? (
            <div className="flex flex-wrap gap-1.5 px-3 pt-3">
              {attachments.map((file) => (
                <AttachmentChip
                  key={file.id}
                  file={file}
                  onRemove={() =>
                    setAttachments((previous) => previous.filter((entry) => entry.id !== file.id))
                  }
                />
              ))}
            </div>
          ) : null}

          {attachError ? (
            <p className="px-4 pt-2 text-[12px] text-danger">{attachError}</p>
          ) : null}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(event) => {
              const next = event.target.value
              const caret = event.target.selectionStart ?? next.length
              // "@" typed at the start of a word opens the quote picker. Checked
              // on the committed value, after any IME composition, and only for
              // a single inserted character so a pasted address does not fire.
              const typed = next.length === value.length + 1 ? next[caret - 1] : ''
              const before = caret >= 2 ? next[caret - 2] : ''
              if ((typed === '@' || typed === '＠') && (!before || /\s/.test(before))) {
                atRef.current = caret - 1
                setValue(next.slice(0, caret - 1) + next.slice(caret))
                setReferencePicker({})
                return
              }
              setValue(next)
            }}
            onKeyDown={onKeyDown}
            rows={1}
            onPaste={(event) => {
              // Screenshots and copied files arrive on the clipboard, and a
              // paste that silently dropped them would look like a broken app.
              const files = [...(event.clipboardData?.files ?? [])]
              if (!files.length) return
              event.preventDefault()
              void addFiles(files)
            }}
            placeholder={
              focused || narrowed
                ? targets.length === 1
                  ? t(composer.placeholderOnly, { model: displayName(targets[0].model.modelId) })
                  : t(composer.placeholderSome, { count: targets.length })
                : chips.length > 1
                  ? t(composer.placeholderTogether, { count: chips.length })
                  : t(composer.placeholder)
            }
            className={cn(
              'block w-full bg-transparent px-4 pb-1 pt-3.5',
              'text-[15px] leading-[1.6] text-ink placeholder:text-ink-faint',
              'max-h-[200px] overflow-y-auto',
            )}
          />

          <div className="flex items-center gap-1 px-2 pb-2 pt-1">
            {/* --- Files + model chips, one per visible lane ----------------- */}
            <div ref={chipsRef} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
              <Popover open={addOpen} onOpenChange={setAddOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={reading}
                    aria-label={t(composer.add)}
                    title={t(composer.addTitle)}
                    className={cn(
                      'flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px]',
                      'text-ink-muted',
                      'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                      'hover:bg-surface-hover hover:text-ink',
                      'disabled:pointer-events-none disabled:opacity-40',
                    )}
                  >
                    {reading ? (
                      <Loader2 className="h-[15px] w-[15px] animate-spin" strokeWidth={1.75} />
                    ) : (
                      <Plus className="h-[16px] w-[16px]" strokeWidth={1.75} />
                    )}
                  </button>
                </PopoverTrigger>
                <PopoverContent align="start" side="top" width={232}>
                  <PopoverItem
                    onSelect={() => {
                      setAddOpen(false)
                      void attachFromPicker()
                    }}
                  >
                    <Paperclip className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
                    <span className="flex-1">{t(composer.addFiles)}</span>
                    <span className="text-[11px] text-ink-faint">{t(composer.addFilesHint)}</span>
                  </PopoverItem>
                  <PopoverItem
                    onSelect={() => {
                      setAddOpen(false)
                      setReferencePicker({})
                    }}
                  >
                    <MessageSquareQuote className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
                    <span className="flex-1">{t(composer.quoteChat)}</span>
                    <span className="text-[11px] text-ink-faint">{t(composer.quoteChatHint)}</span>
                  </PopoverItem>
                </PopoverContent>
              </Popover>

              {/*
                With no conversation yet there is no lane to label, so a
                synthetic "draft" chip stands in. It is not persisted — the real
                lane is created by the first send — but it keeps the composer
                honest about which model is about to answer.
              */}
              {chips.map((chip, index) => {
                // Only real columns can be left out; the draft chip is the one
                // model a new conversation starts with.
                const selectable = chips.length > 1 && chip.laneId
                const included = !selectable || targets.some((lane) => lane.id === chip.laneId)
                const lastIncluded = included && targets.length === 1
                const canReorder = chips.length > 1
                const isDraggingChip =
                  draggingChipId === chip.id || Boolean(chip.laneId && draggingLaneId === chip.laneId)
                return (
                  <div
                    key={chip.id}
                    {...(canReorder ? getChipProps(chip.id) : {})}
                    className={cn(
                      'group/chip flex h-7 shrink-0 items-center gap-0.5 rounded-[7px] pr-1',
                      selectable ? 'pl-1' : 'pl-2',
                      'text-[12.5px] font-medium',
                      'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                      canReorder && 'cursor-grab select-none active:cursor-grabbing',
                      included
                        ? 'text-ink-soft hover:bg-surface-hover hover:text-ink'
                        : 'text-ink-faint outline outline-1 -outline-offset-1 outline-dashed outline-line-strong hover:text-ink-muted',
                      isDraggingChip && 'bg-surface-active text-ink ring-1 ring-line-strong',
                    )}
                  >
                    {selectable ? (
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={included}
                        aria-label={t(composer.sendTo, { model: displayName(chip.model.modelId) })}
                        disabled={lastIncluded}
                        title={
                          lastIncluded
                            ? t(composer.atLeastOneModel)
                            : included
                              ? t(composer.excludeFromNext, { model: displayName(chip.model.modelId) })
                              : t(composer.includeFromNext, { model: displayName(chip.model.modelId) })
                        }
                        onClick={() => toggleLaneExcluded(chip.laneId!)}
                        className={cn(
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full',
                          'disabled:cursor-default',
                        )}
                      >
                        <span
                          className={cn(
                            'flex h-3.5 w-3.5 items-center justify-center rounded-full',
                            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                            included ? 'bg-ink text-paper' : 'border border-line-strong',
                          )}
                        >
                          {included ? <Check className="h-2.5 w-2.5" strokeWidth={3} /> : null}
                        </span>
                      </button>
                    ) : null}
                    {chip.laneId || index === 0 ? (
                      <ModelPicker
                        value={chip.model}
                        onSelect={(model) => {
                          setComposerModel(model)
                          // A real lane also has its model switched, so the next
                          // turn in this column uses it. The draft chip has no lane
                          // to switch — the conversation is created on send.
                          if (chip.laneId) void switchLaneModel(chip.laneId, model)
                        }}
                        trigger={
                          <button
                            type="button"
                            className={cn(
                              'flex min-w-0 items-center gap-1.5 py-1',
                              canReorder && 'cursor-grab active:cursor-grabbing',
                            )}
                            title={displayName(chip.model.modelId)}
                          >
                            <ModelIcon
                              modelId={chip.model.modelId}
                              className={cn('h-3.5 w-3.5', !included && 'opacity-50 grayscale')}
                            />
                            {/*
                              The cap tightens as columns are added: two chips at
                              150px each already crowd the controls on a narrow
                              window, and the composer must never push the search
                              or send button out of reach.
                            */}
                            <span
                              className={cn(
                                'truncate',
                                chips.length > 1 ? 'max-w-[84px]' : 'max-w-[150px]',
                              )}
                            >
                              {displayName(chip.model.modelId)}
                            </span>
                            <ChevronDown className="h-3 w-3 shrink-0 opacity-50" strokeWidth={2} />
                          </button>
                        }
                      />
                    ) : (
                      // A default comparison model before the first send: shown
                      // so the user sees every column that will answer, changed
                      // in settings or with the chip once the conversation exists.
                      <span
                        className={cn(
                          'flex min-w-0 items-center gap-1.5 py-1',
                          canReorder && 'cursor-grab active:cursor-grabbing',
                        )}
                        title={t(composer.defaultCompareModel, { model: displayName(chip.model.modelId) })}
                      >
                        <ModelIcon modelId={chip.model.modelId} className="h-3.5 w-3.5" />
                        <span className="max-w-[84px] truncate">{displayName(chip.model.modelId)}</span>
                      </span>
                    )}
                    {chips.length > 1 && chip.laneId ? (
                      <button
                        type="button"
                        data-no-drag
                        onClick={() => {
                          const lane = lanes.find((entry) => entry.id === chip.laneId)
                          void removeLane(chip.laneId!)
                          if (lane) setJustRemoved(lane)
                        }}
                        aria-label={t(composer.remove, { name: displayName(chip.model.modelId) })}
                        className={cn(
                          'flex h-5 w-5 items-center justify-center rounded-[5px]',
                          'text-ink-faint opacity-0 transition-opacity duration-[var(--dur-instant)]',
                          'hover:text-ink group-hover/chip:opacity-100',
                        )}
                      >
                        <X className="h-3 w-3" strokeWidth={2} />
                      </button>
                    ) : null}
                  </div>
                )
              })}

              {focused ? (
                <button
                  type="button"
                  onClick={() => setFocusedLane(null)}
                  title={t(composer.backToSideBySide)}
                  className={cn(
                    'flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2',
                    'text-[12px] text-ink-muted',
                    'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                    'hover:bg-surface-hover hover:text-ink',
                  )}
                >
                  <span className="whitespace-nowrap">{t(composer.viewingAlone)}</span>
                  <span className="text-ink-faint">·</span>
                  <span className="whitespace-nowrap font-medium text-ink-soft">
                    {t(composer.allColumns, { count: lanes.length })}
                  </span>
                </button>
              ) : null}

              {narrowed ? (
                <button
                  type="button"
                  onClick={includeAllLanes}
                  title={t(composer.sendToAllTitle)}
                  className={cn(
                    'flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2',
                    'text-[12px] text-ink-muted',
                    'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                    'hover:bg-surface-hover hover:text-ink',
                  )}
                >
                  <span className="whitespace-nowrap">
                    {targets.length === 1
                      ? t(composer.onlyItAnswers)
                      : t(composer.someAnswering, { n: targets.length, total: lanes.length })}
                  </span>
                  <span className="text-ink-faint">·</span>
                  <span className="whitespace-nowrap font-medium text-ink-soft">{t(composer.all)}</span>
                </button>
              ) : null}
            </div>

            {/* The controls hold their size; only the chip row flexes. */}
            <div className="flex shrink-0 items-center gap-1">
            {/* --- Compare -------------------------------------------------- */}
            <CompareControl
              lanes={lanes.length}
              taken={lanes.length ? lanes.map((lane) => lane.model) : chips.map((chip) => chip.model)}
              removed={removed}
              onAdd={(model) => void addLane(model)}
              onRestore={(laneId) => {
                void restoreLane(laneId)
                if (justRemoved?.id === laneId) setJustRemoved(null)
              }}
            />

            {reasoningNote && chips.length <= 1 ? (
              <Tooltip label={reasoningNote}>
                <span
                  className={cn(
                    'flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2',
                    'text-[12.5px] font-medium text-ink-faint',
                  )}
                >
                  <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
                  <span>{t(composer.reasoningDefault)}</span>
                </span>
              </Tooltip>
            ) : null}

            {/* --- Search toggle -------------------------------------------- */}
            <SearchToggle
              value={composerSearch}
              onChange={setComposerSearch}
              capabilities={capabilities}
              modelId={activeModel?.modelId ?? null}
            />

            {/* --- Reasoning depth ------------------------------------------ */}
            {chips.length > 1 && chips.every((chip) => chip.laneId) ? (
              laneDepths.some((lane) => lane.levels.length || lane.note) ? (
                <LaneReasoningControl lanes={laneDepths} onChange={setLaneReasoning} />
              ) : null
            ) : levels.length ? (
              <ReasoningToggle
                // A focused column keeps its own depth: the one it answers with.
                value={effectiveLevel((focused && laneReasoning[focused.id]) || composerReasoning, levels)}
                levels={levels}
                onChange={(level) => {
                  if (!focused) setComposerReasoning(level)
                  // Keep the column in step, so adding a second model later
                  // starts this one from what the user last picked for it.
                  const laneId = chips[0]?.laneId
                  if (laneId) setLaneReasoning(laneId, level)
                }}
              />
            ) : null}

            {/* --- Send / stop ---------------------------------------------- */}
            {isRunning ? (
              <Tooltip label={t(composer.stop)} shortcut={stopShortcut}>
                <Button
                  size="icon"
                  variant="subtle"
                  onClick={stopTurn}
                  aria-label={t(composer.stopGenerating)}
                  className="h-8 w-8 rounded-[var(--radius-full)]"
                >
                  <Square className="h-[13px] w-[13px] fill-current" strokeWidth={2} />
                </Button>
              </Tooltip>
            ) : (
              <Button
                size="icon"
                variant="primary"
                onClick={submit}
                disabled={!value.trim()}
                aria-label={t(composer.send)}
                className="h-8 w-8 rounded-[var(--radius-full)]"
              >
                <ArrowUp className="h-[17px] w-[17px]" strokeWidth={2.25} />
              </Button>
            )}
            </div>
          </div>
        </div>

        {/*
          One hidden input for every attach path. `multiple` because attaching a
          handful of files at once is the normal case for the questions this app
          is used for, and `accept` is only a hint — anything dropped is checked
          for itself in `readAttachment`.
        */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          accept=".png,.jpg,.jpeg,.gif,.webp,.bmp,.heic,.pdf,.txt,.md,.markdown,.csv,.tsv,.json,.jsonl,.yaml,.yml,.toml,.xml,.html,.css,.js,.jsx,.ts,.tsx,.py,.rb,.go,.rs,.java,.kt,.swift,.c,.h,.cpp,.hpp,.cs,.php,.sh,.sql,.docx,.xlsx,.pptx"
          onChange={(event) => {
            const files = event.target.files
            if (files?.length) void addFiles(files)
            // Reset so picking the same file twice fires again.
            event.target.value = ''
          }}
        />

        {referencePicker ? (
          <ReferencePicker
            conversationId={referencePicker.conversationId}
            onPick={(attachment) => {
              atRef.current = null
              setReferencePicker(null)
              setAttachments((previous) => [...previous, attachment])
              requestAnimationFrame(() => textareaRef.current?.focus())
            }}
            onClose={() => {
              const at = atRef.current
              atRef.current = null
              setReferencePicker(null)
              if (at !== null) {
                setValue((current) => `${current.slice(0, at)}@${current.slice(at)}`)
                requestAnimationFrame(() => {
                  const node = textareaRef.current
                  if (!node) return
                  node.focus()
                  node.selectionStart = node.selectionEnd = at + 1
                })
              }
            }}
          />
        ) : null}

        <p className="mt-2 text-center text-[11.5px] text-ink-faint">
          {t(composer.footerHint)}
        </p>
      </div>
    </div>
  )
}

/**
 * One attached file, as a chip above the textarea.
 *
 * The line under the name is the honest part: an image on a model without
 * vision, or a PDF whose text could not be extracted, is going to reach the
 * model as nothing. Saying so here beats an answer that ignores the file.
 */
function AttachmentChip({ file, onRemove }: { file: Attachment; onRemove: () => void }) {
  const t = useT()
  const providers = useStore((state) => state.providers)
  const composerModel = useStore((state) => state.composerModel)
  const graph = useStore((state) => state.graph)

  const target =
    composerModel ??
    (graph ? visibleLanes(graph.conversation.lanes)[0]?.model : undefined) ??
    null

  // Images and PDFs are gated separately: the catalog has models that read one
  // and not the other, and the chip should say which it is.
  const input = useMemo(() => {
    if (!target) return { vision: false, pdf: false }
    const provider = providers.find((entry) => entry.id === target.providerId)
    if (!provider) return { vision: false, pdf: false }
    const capabilities = capabilitiesFor(provider, target.modelId)
    return { vision: capabilities.vision, pdf: capabilities.pdf }
  }, [providers, target])

  // Only images need the model to be able to see them; a PDF always travels as
  // the text extracted on this machine, so it is readable everywhere.
  const isImage = isImageExt(file.ext)
  const readable = !isImage || hasNativeInput(file.ext, input)
  const reference = file.reference
  const detail =
    file.note ??
    (reference
      ? [
          t(composer.rounds, { count: reference.turns }),
          reference.modelId ? displayName(reference.modelId) : null,
          t(composer.characters, { count: (file.text?.length ?? 0).toLocaleString() }),
        ]
          .filter(Boolean)
          .join(' · ')
      : !readable
        ? t(composer.imageNotVisible)
        : file.text
          ? `${formatBytes(file.bytes)} · ${t(composer.characters, { count: file.text.length.toLocaleString() })}`
          : formatBytes(file.bytes))

  const warning = Boolean(file.note) || !readable

  return (
    <span
      className={cn(
        'group/att flex max-w-[240px] items-center gap-2 rounded-[9px] border px-2 py-1.5',
        warning ? 'border-line-strong bg-surface' : 'border-line',
      )}
    >
      {reference ? (
        <MessageSquareQuote className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} />
      ) : isImage ? (
        <ImageIcon className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-ink-muted" strokeWidth={1.75} />
      )}
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="truncate text-[12px] font-medium text-ink-soft">{reference ? reference.title : file.name}</span>
        <span className={cn('truncate text-[10.5px]', warning ? 'text-ink-faint' : 'text-ink-faint')}>
          {detail}
        </span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={t(composer.remove, { name: file.name })}
        className={cn(
          'flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] text-ink-faint',
          'opacity-0 transition-opacity duration-[var(--dur-instant)]',
          'hover:text-ink group-hover/att:opacity-100 focus-visible:opacity-100',
        )}
      >
        <X className="h-3 w-3" strokeWidth={2} />
      </button>
    </span>
  )
}

/**
 * Compare: its own control, at the end of the composer.
 *
 * Adding more than one model to a question is a different action from attaching
 * a file, and it used to share the attach affordance — a plus in the chip row
 * that read as "add something" and did something narrower. Here it is a labelled
 * button on the right, with the model list behind it, and the lane count on its
 * face once comparison is on.
 *
 * Columns taken out of the comparison are listed first, under 已移除, with how
 * much they had answered: bringing one back restores its answers rather than
 * starting the model over, so it is a different act from adding.
 */
function CompareControl({
  lanes,
  taken,
  removed,
  onAdd,
  onRestore,
}: {
  lanes: number
  /** Models already answering in a column; each may appear only once. */
  taken: { providerId: string; modelId: string }[]
  removed: { lane: Lane; answers: number; duplicate: boolean }[]
  onAdd: (model: { providerId: string; modelId: string }) => void
  onRestore: (laneId: string) => void
}) {
  const t = useT()
  const models = useAvailableModels()
  const [open, setOpen] = useState(false)
  const comparing = lanes > 1
  const full = lanes >= MAX_LANES

  const same = (a: { providerId: string; modelId: string }, b: { providerId: string; modelId: string }) =>
    a.providerId === b.providerId && a.modelId === b.modelId
  // A model with a removed column is offered only as that column, under 已移除.
  const options = models.filter(
    (model) => !taken.some((lane) => same(lane, model)) && !removed.some((entry) => same(entry.lane.model, model)),
  )
  const restorable = removed.filter((entry) => !entry.duplicate)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={full || (!options.length && !restorable.length)}
          title={
            full
              ? t(composer.maxLanes, { max: MAX_LANES })
              : comparing
                ? t(composer.comparingTitle, { count: lanes })
                : t(composer.compareTitle)
          }
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-[7px] px-2',
            'text-[12.5px] font-medium',
            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'disabled:pointer-events-none disabled:opacity-35',
            comparing
              ? 'bg-surface-active text-ink'
              : 'text-ink-muted hover:bg-surface-hover hover:text-ink-soft',
          )}
        >
          <Columns2 className="h-3.5 w-3.5" strokeWidth={1.75} />
          {comparing ? <span>{t(composer.columns, { count: lanes })}</span> : <span>{t(composer.compare)}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" width={300} className="max-h-[380px] overflow-y-auto">
        {restorable.length ? (
          <>
            <PopoverLabel>{t(composer.removed)}</PopoverLabel>
            {restorable.map(({ lane, answers }) => (
              <PopoverItem
                key={lane.id}
                onSelect={() => {
                  onRestore(lane.id)
                  if (lanes + 1 >= MAX_LANES) setOpen(false)
                }}
              >
                <ModelIcon modelId={lane.model.modelId} className="h-3.5 w-3.5 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate">{displayName(lane.model.modelId)}</span>
                <span className="shrink-0 text-[11px] text-ink-faint">
                  {t(composer.answeredRounds, { count: answers })}
                </span>
                <RotateCcw
                  className="h-3 w-3 shrink-0 text-ink-faint"
                  strokeWidth={2}
                  aria-label={t(composer.restore)}
                />
              </PopoverItem>
            ))}
            {options.length ? <PopoverSeparator /> : null}
          </>
        ) : null}
        {options.length ? (
          <PopoverLabel>{comparing ? t(composer.addAnotherModel) : t(composer.compareSideBySide)}</PopoverLabel>
        ) : null}
        {options.map((model) => (
          <PopoverItem
            key={`${model.providerId}:${model.modelId}`}
            onSelect={() => {
              onAdd({ providerId: model.providerId, modelId: model.modelId })
              // Stays open: adding a model is not a completed interaction, and
              // closing it made comparing three models a three-popover job.
              if (lanes + 1 >= MAX_LANES) setOpen(false)
            }}
          >
            <ModelIcon modelId={model.modelId} className="h-3.5 w-3.5 text-ink-muted" />
            <span className="min-w-0 flex-1 truncate">{displayName(model.modelId)}</span>
            <span className="shrink-0 text-[11px] text-ink-faint">{model.providerName}</span>
          </PopoverItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Web search toggle.
 *
 * Off, on-native, or on with a specific third-party backend. When the selected
 * model has no hosted search and no adapter key is configured, the control is
 * disabled with an explanation rather than silently doing nothing.
 */
function SearchToggle({
  value,
  onChange,
  capabilities,
  modelId,
}: {
  value: SearchMode
  onChange: (mode: SearchMode) => void
  capabilities: { nativeSearch: boolean; tools: boolean }
  modelId: string | null
}) {
  const t = useT()
  const active = value !== 'none'
  const hasAnyBackend = capabilities.nativeSearch || capabilities.tools

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={!hasAnyBackend}
          aria-label={t(composer.webSearch)}
          title={
            hasAnyBackend
              ? active
                ? t(composer.webSearchMode, { mode: labelForMode(value) })
                : t(composer.webSearchOff)
              : t(composer.webSearchUnsupported)
          }
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2',
            'text-[12.5px] font-medium',
            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'disabled:pointer-events-none disabled:opacity-35',
            active
              ? 'bg-surface-active text-ink'
              : 'text-ink-muted hover:bg-surface-hover hover:text-ink-soft',
          )}
        >
          <Globe className="h-3.5 w-3.5" strokeWidth={1.75} />
          {active ? <span>{labelForMode(value)}</span> : null}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" width={244}>
        <PopoverLabel>{t(composer.webSearch)}</PopoverLabel>
        <PopoverItem
          selected={value === 'none'}
          onSelect={() => onChange('none')}
        >
          <span className="h-3.5 w-3.5" aria-hidden />
          <span className="flex-1">{t(composer.off)}</span>
          {value === 'none' ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
        </PopoverItem>

        <PopoverSeparator />

        <PopoverItem
          selected={value === 'native'}
          disabled={!capabilities.nativeSearch}
          onSelect={() => onChange('native')}
        >
          {modelId ? (
            <ModelIcon modelId={modelId} className="h-3.5 w-3.5 text-ink-muted" />
          ) : (
            <Globe className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
          )}
          <span className="flex-1">
            {t(composer.builtInSearch)}
            {!capabilities.nativeSearch ? (
              <span className="ml-1.5 text-[11px] text-ink-faint">{t(composer.unsupported)}</span>
            ) : null}
          </span>
          {value === 'native' ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
        </PopoverItem>

        {/*
          Native search is per-vendor, so a model's own search and a third-party
          API return differently-shaped results. Both render through the same
          step row and citation chips, which is why this reads as one feature.
        */}
        {(['tavily', 'brave', 'exa'] as const).map((mode) => (
          <PopoverItem
            key={mode}
            selected={value === mode}
            disabled={!capabilities.tools}
            onSelect={() => onChange(mode)}
          >
            <BrandIcon brand={mode} className="h-3.5 w-3.5 text-ink-muted" />
            <span className="flex-1">{labelForMode(mode)}</span>
            {value === mode ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
          </PopoverItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}

function labelForMode(mode: SearchMode): string {
  switch (mode) {
    case 'native':
      return t(composer.searchNative)
    case 'tavily':
      return 'Tavily'
    case 'brave':
      return 'Brave'
    case 'exa':
      return 'Exa'
    default:
      return t(composer.searchNative)
  }
}

/**
 * Reasoning depth control.
 *
 * Only the levels the model actually supports are listed, and the control hides
 * entirely on models that do not reason — offering a depth setting that will be
 * ignored is worse than not offering it.
 */
function ReasoningToggle({
  value,
  levels,
  onChange,
}: {
  value: ReasoningLevel
  levels: ReasoningLevel[]
  onChange: (level: ReasoningLevel) => void
}) {
  const t = useT()
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(composer.reasoningDepth)}
          title={t(composer.reasoningDepthValue, { level: REASONING_LABELS[value] })}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2',
            'text-[12.5px] font-medium text-ink-muted',
            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'hover:bg-surface-hover hover:text-ink-soft',
          )}
        >
          <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
          <span>{REASONING_LABELS[value]}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" width={168}>
        <PopoverLabel>{t(composer.reasoningDepth)}</PopoverLabel>
        {levels.map((level) => (
          <PopoverItem key={level} selected={value === level} onSelect={() => onChange(level)}>
            <span className="flex-1">{REASONING_LABELS[level]}</span>
            {value === level ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
          </PopoverItem>
        ))}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Reasoning depth for each column of a comparison.
 *
 * One button, one panel, a row per column. Each row is that model's own
 * segmented scale, so a GPT offering 超高 and 最高 sits beside a DeepSeek that
 * only switches thinking on and off, and neither is cut down to the other's
 * vocabulary. The panel stays open while adjusting: setting three columns is
 * one gesture, not three trips to a menu.
 *
 * The button's face reads the columns left to right (`中 · 高`), collapsing to
 * one label when they agree, so the setup is legible without opening it.
 */
function LaneReasoningControl({
  lanes,
  onChange,
}: {
  lanes: {
    id: string
    laneId: string | null
    model: { providerId: string; modelId: string }
    levels: ReasoningLevel[]
    note: string | null
    value: ReasoningLevel
  }[]
  onChange: (laneId: string, level: ReasoningLevel) => void
}) {
  const t = useT()
  const shown = lanes.map((lane) => ({ ...lane, current: effectiveLevel(lane.value, lane.levels) }))
  const adjustable = shown.filter((lane) => lane.levels.length)
  const faces = adjustable.map((lane) => REASONING_LABELS[lane.current])
  const face = faces.every((label) => label === faces[0]) ? faces[0] : faces.join(' · ')

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={t(composer.reasoningDepth)}
          title={t(composer.reasoningDepthValue, {
            level: adjustable
              .map((lane) => `${displayName(lane.model.modelId)} ${REASONING_LABELS[lane.current]}`)
              .join(t(composer.listSeparator)),
          })}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1 rounded-[7px] px-2',
            'text-[12.5px] font-medium text-ink-muted',
            'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
            'hover:bg-surface-hover hover:text-ink-soft',
          )}
        >
          <Brain className="h-3.5 w-3.5" strokeWidth={1.75} />
          {face ? <span className="whitespace-nowrap">{face}</span> : <span>{t(composer.reasoningDefault)}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" width={340}>
        <PopoverLabel>{t(composer.reasoningPerColumn)}</PopoverLabel>
        <div className="flex flex-col gap-0.5 pb-1">
          {shown.map((lane) => (
            <div
              key={lane.id}
              role="group"
              aria-label={t(composer.modelReasoning, { model: displayName(lane.model.modelId) })}
              className="flex flex-col gap-1.5 rounded-[7px] px-2 py-1.5"
            >
              <div className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
                <ModelIcon modelId={lane.model.modelId} className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <span className="truncate">{displayName(lane.model.modelId)}</span>
              </div>
              {lane.levels.length && lane.laneId ? (
                <div className="flex w-full gap-0.5 rounded-[8px] bg-surface p-0.5">
                  {lane.levels.map((level) => {
                    const selected = lane.current === level
                    return (
                      <button
                        key={level}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => onChange(lane.laneId!, level)}
                        className={cn(
                          'h-6 min-w-0 flex-1 rounded-[6px] px-1.5 text-[12px] font-medium',
                          'transition-[background-color,color,box-shadow] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                          selected
                            ? 'bg-paper text-ink shadow-[var(--shadow-raised)]'
                            : 'text-ink-muted hover:text-ink-soft',
                        )}
                      >
                        {REASONING_LABELS[level]}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <p className="pl-5 text-[11.5px] leading-relaxed text-ink-faint">
                  {lane.note ?? t(composer.reasoningNotAdjustable)}
                </p>
              )}
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}
