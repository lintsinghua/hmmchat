import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Check,
  ChevronRight,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react'

import { useStore, type PersistedSettings } from '@/chat/store'
import {
  PROVIDER_PRESETS,
  displayName,
  providerIdFor,
  type ProviderConfig,
  type ProviderPreset,
  type ReasoningWire,
} from '@/providers/registry'
import { fetchModels, preferredModels } from '@/providers/models-fetch'
import { probeMany, probeModel, type ProbeResult } from '@/providers/probe'
import { BrandIcon, ModelIcon, ProviderIcon, brandForProvider } from '@/components/icons/BrandIcon'
import { Tooltip } from '@/components/ui/Tooltip'
import { SEARCH_ADAPTERS } from '@/search/adapters'
import * as db from '@/lib/db'
import { originOf, secretNameForProvider, setSecret, deleteSecret, listSecretNames } from '@/lib/secrets'
import { useTheme, type ThemePreference } from '@/hooks/useTheme'
import { MAX_LANES, refreshSummaries } from '@/chat/session'
import type { ModelRef, ReasoningLevel, SearchMode } from '@/chat/types'
import { REASONING_LABELS } from '@/providers/reasoning'
import { useAvailableModels } from '@/components/model/ModelPicker'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Dialog, DialogContent, DialogHiddenTitle } from '@/components/ui/Dialog'
import type { ProviderKind } from '@/providers/reasoning'
import {
  SHORTCUTS,
  bindingFromEvent,
  findConflict,
  formatBinding,
  type ShortcutId,
} from '@/lib/shortcuts'
import { resolveShortcuts } from '@/components/palette/CommandPalette'
import { useT, type Entry, type Language } from '@/i18n/core'
import { settings as copy } from '@/i18n'

/**
 * Settings.
 *
 * A modal rather than a route or a panel. There is no second navigation column
 * anywhere in the app — provider configuration is a rare, deliberate action and
 * belongs behind one door, which is the main structural difference from the
 * aggregator apps this replaces.
 */

type Section = 'providers' | 'defaults' | 'search' | 'general' | 'shortcuts'

const SECTIONS: Array<{ id: Section; label: Entry }> = [
  { id: 'providers', label: copy.sectionProviders },
  { id: 'defaults', label: copy.sectionDefaults },
  { id: 'search', label: copy.sectionSearch },
  { id: 'general', label: copy.sectionGeneral },
  { id: 'shortcuts', label: copy.sectionShortcuts },
]

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const t = useT()
  const [section, setSection] = useState<Section>('providers')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent width={720} height={560} className="flex">
        <DialogHiddenTitle>{t(copy.dialogTitle)}</DialogHiddenTitle>

        <nav className="flex w-[164px] shrink-0 flex-col border-r border-line bg-surface/50 p-2">
          {SECTIONS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSection(entry.id)}
              className={cn(
                'rounded-[8px] px-2.5 py-[7px] text-left text-[13px] font-medium',
                'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                section === entry.id
                  ? 'bg-surface-active text-ink'
                  : 'text-ink-soft hover:bg-surface-hover hover:text-ink',
              )}
            >
              {t(entry.label)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 overflow-y-auto">
          {section === 'providers' ? <ProvidersSection /> : null}
          {section === 'search' ? <SearchSection /> : null}
          {section === 'defaults' ? <DefaultsSection /> : null}
          {section === 'general' ? <GeneralSection /> : null}
          {section === 'shortcuts' ? <ShortcutsSection /> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

function ProvidersSection() {
  const t = useT()
  const providers = useStore((state) => state.providers)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [configuringId, setConfiguringId] = useState<string | null>(null)

  const reload = async () => {
    const rows = await db.listProviders()
    useStore.getState().setProviders(
      rows.map((row) => ({
        id: row.id,
        kind: row.kind as ProviderKind,
        name: row.name,
        baseUrl: row.base_url,
        enabled: row.enabled === 1,
        models: JSON.parse(row.models) as Array<{ id: string; enabled: boolean }>,
      })),
    )
  }

  useEffect(() => {
    void reload()
  }, [])

  return (
    <div className="p-5">
      <header className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">{t(copy.sectionProviders)}</h2>
          <p className="mt-0.5 text-[12.5px] text-ink-muted">
            {t(copy.providersIntro)}
          </p>
        </div>
        <Button size="sm" variant="subtle" onClick={() => setAdding((value) => !value)}>
          <Plus className="h-3.5 w-3.5" strokeWidth={2} />
          {t(copy.add)}
        </Button>
      </header>

      {adding ? (
        <ProviderForm
          onDone={async () => {
            setAdding(false)
            await reload()
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      <div className="flex flex-col gap-2">
        {providers.length === 0 && !adding ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-line px-4 py-6 text-center text-[13px] text-ink-muted">
            {t(copy.providersEmpty)}
          </p>
        ) : null}

        {providers.map((provider) => (
          <div key={provider.id} className="overflow-hidden rounded-[var(--radius-md)] border border-line">
            {configuringId === provider.id ? (
              <ProviderForm
                provider={provider}
                onDone={async () => {
                  setConfiguringId(null)
                  await reload()
                  await refreshSummaries()
                }}
                onCancel={() => setConfiguringId(null)}
              />
            ) : null}

            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                type="button"
                onClick={() => setEditingId(editingId === provider.id ? null : provider.id)}
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
              >
                <ChevronRight
                  className={cn(
                    'h-3.5 w-3.5 shrink-0 text-ink-faint transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out)]',
                    editingId === provider.id && 'rotate-90',
                  )}
                  strokeWidth={2}
                />
                <ProviderIcon provider={provider} className="h-[15px] w-[15px] text-ink-soft" />
                <span className="truncate text-[13.5px] font-medium text-ink">{provider.name}</span>
                <span className="shrink-0 text-[12px] text-ink-faint">
                  {t(copy.providerModelCount, { count: provider.models?.filter((model) => model.enabled).length ?? 0 })}
                </span>
              </button>

              <Button
                size="icon-sm"
                onClick={() => setConfiguringId(provider.id)}
                aria-label={t(copy.editProvider)}
                title={t(copy.editProviderHint)}
              >
                <Pencil className="h-[15px] w-[15px]" strokeWidth={1.75} />
              </Button>

              <Button
                size="icon-sm"
                onClick={async () => {
                  await db.deleteProvider(provider.id)
                  // The key is bound to the origin, so it is deleted with the
                  // provider rather than left orphaned in the native store.
                  await deleteSecret(secretNameForProvider(provider.id))
                  await reload()
                  await refreshSummaries()
                }}
                aria-label={t(copy.deleteProvider)}
              >
                <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.75} />
              </Button>
            </div>

            {configuringId === provider.id ? null : editingId === provider.id ? (
              <ProviderDetail provider={provider} onChanged={reload} />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Add or edit one provider.
 *
 * The preset list is the whole of "which vendor": DeepSeek and Ollama are on it
 * beside Anthropic, because the app reaches them just as directly, and the base
 * URL is filled in for you. Only 自定义端点 asks for a URL, which is the case
 * that actually needs one.
 *
 * Editing reuses this form. Everything but the key — name, base URL, which
 * models are enabled — is in SQLite and can be rewritten; the key cannot be read
 * back, so leaving the field empty keeps the stored one and typing replaces it.
 */
function ProviderForm({
  provider,
  onDone,
  onCancel,
}: {
  /** Present when editing an existing provider. */
  provider?: ProviderConfig
  onDone: () => void
  onCancel: () => void
}) {
  const t = useT()
  const editing = Boolean(provider)

  const [preset, setPreset] = useState<ProviderPreset | null>(() => {
    if (!provider) return null
    return (
      PROVIDER_PRESETS.find(
        (entry) => entry.kind === provider.kind && entry.baseUrl === provider.baseUrl,
      ) ?? { kind: provider.kind, name: provider.name, baseUrl: provider.baseUrl, hint: '' }
    )
  })
  const [name, setName] = useState(provider?.name ?? '')
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? '')
  const [apiKey, setApiKey] = useState('')
  const [wire, setWire] = useState<ReasoningWire>(provider?.reasoningWire ?? 'auto')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const choose = (entry: ProviderPreset) => {
    setPreset(entry)
    setBaseUrl(entry.baseUrl)
    // A local endpoint has no account to name it after; the preset name is the
    // only sensible default.
    setName(entry.kind === 'openai-compatible' && entry.baseUrl === '' ? '' : entry.name)
  }

  const save = async () => {
    if (!preset) return
    // A key is required only when there is not already one stored.
    if (!editing && !apiKey.trim()) return
    setBusy(true)
    setError(null)
    setNotice(null)

    const id = provider?.id ?? providerIdFor(preset)
    const finalName = name.trim() || preset.name

    try {
      const previousOrigin = provider ? originOf(provider.baseUrl) : null
      const nextOrigin = originOf(baseUrl)
      const secretName = secretNameForProvider(id)

      // A key is bound to an origin and only resolves against it. Changing the
      // base URL of an existing provider would silently strand the stored key,
      // so say so rather than leaving the user with unexplained 401s.
      if (editing && apiKey.trim() && previousOrigin && previousOrigin !== nextOrigin) {
        setNotice(t(copy.baseUrlChangedNotice))
      }

      if (apiKey.trim()) {
        await setSecret(secretName, apiKey.trim(), nextOrigin)
      }

      let models = provider?.models ?? []
      if (!editing || !models.length) {
        try {
          const discovered = await fetchModels(id, preset.kind, baseUrl)
          const preferred = new Set(preferredModels(preset.kind, discovered))
          models = discovered.map((model) => ({
            id: model.id,
            enabled: preferred.has(model.id),
          }))
        } catch {
          // Discovery is a convenience; a manually typed model id still works, so
          // a failure here must not block saving the provider.
          setError(t(copy.modelListFetchFailed))
        }
      }

      await db.upsertProvider({
        id,
        kind: preset.kind,
        name: finalName,
        baseUrl,
        enabled: provider?.enabled ?? true,
        models,
        // Only meaningful for a compatible endpoint; left unset elsewhere so the
        // vendor's own mapping stays in charge.
        reasoningWire: preset.kind === 'openai-compatible' ? wire : undefined,
      })
      onDone()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  if (!preset) {
    return (
      <div className="mb-4 rounded-[var(--radius-md)] border border-line p-3">
        <div className="mb-2.5 flex items-center justify-between px-1">
          <span className="text-[12.5px] font-medium text-ink-soft">{t(copy.chooseProvider)}</span>
          <button
            type="button"
            onClick={onCancel}
            className="text-ink-faint hover:text-ink"
            aria-label={t(copy.cancel)}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {PROVIDER_PRESETS.map((entry, index) => (
            <Fragment key={`${entry.name}-${entry.baseUrl}`}>
              {/*
                A rule between the vendors the app speaks natively and the ones
                it reaches over the OpenAI-compatible protocol. It is a real
                distinction — it decides which capability hints the app can give
                — and it is the difference between a list of eleven equals and a
                list of four with everything else relegated to a form.
              */}
              {index === 4 ? (
                <div className="col-span-2 flex items-center gap-2 px-1 pt-1.5 pb-0.5">
                  <span className="text-[11px] font-medium tracking-wide text-ink-faint">
                    {t(copy.openaiCompatibleGroup)}
                  </span>
                  <span className="h-px flex-1 bg-line" />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => choose(entry)}
                className={cn(
                  'flex items-center gap-2 rounded-[9px] border border-line px-3 py-2 text-left',
                  'transition-[background-color,border-color] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                  'hover:border-line-strong hover:bg-surface-hover',
                )}
              >
                {entry.baseUrl === '' ? (
                  <Plus className="h-4 w-4 shrink-0 text-ink-soft" strokeWidth={1.75} />
                ) : (
                  <BrandIcon
                    brand={brandForProvider({
                      kind: entry.kind,
                      baseUrl: entry.baseUrl,
                      name: entry.name,
                    })}
                    fallback={entry.name}
                    className="text-ink-soft"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink">
                    {entry.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11.5px] leading-snug text-ink-faint">
                    {entry.hint}
                  </span>
                </span>
              </button>
            </Fragment>
          ))}
        </div>
      </div>
    )
  }

  const localEndpoint = /^https?:\/\/(127\.0\.0\.1|localhost|0\.0\.0\.0)/.test(baseUrl)

  return (
    <div className="mb-4 rounded-[var(--radius-md)] border border-line p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <span className="flex items-center gap-1.5 text-[12.5px] font-medium text-ink-soft">
          {editing ? (
            <>
              <ProviderIcon
                provider={{ kind: preset.kind, baseUrl, name }}
                className="h-3.5 w-3.5"
              />
              {t(copy.editingProvider, { name: provider?.name ?? '' })}
            </>
          ) : (
            t(copy.configure)
          )}
        </span>
        <button
          type="button"
          onClick={onCancel}
          className="text-ink-faint hover:text-ink"
          aria-label={t(copy.cancel)}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <Field label={t(copy.fieldName)}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t(copy.fieldNamePlaceholder)}
            className="w-full text-[13px]"
          />
        </Field>

        <Field label={t(copy.fieldBaseUrl)}>
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            spellCheck={false}
            className="w-full font-mono text-[12.5px]"
          />
        </Field>

        <Field label={t(copy.fieldApiKey)}>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={
              editing
                ? t(copy.apiKeyKeepPlaceholder)
                : localEndpoint
                  ? t(copy.apiKeyLocalPlaceholder)
                  : 'sk-…'
            }
            spellCheck={false}
            autoComplete="off"
            className="w-full font-mono text-[12.5px]"
          />
        </Field>

        {/*
          Only a compatible endpoint needs this. The app infers depth from the
          model id, which is right for a relay; a self-hosted server is the case
          where the guess can be wrong, and a wrong guess is a 400 on every
          message rather than a degraded answer.
        */}
        {preset.kind === 'openai-compatible' ? (
          <Field label={t(copy.fieldReasoningWire)}>
            <select
              value={wire}
              onChange={(event) => setWire(event.target.value as ReasoningWire)}
              className="w-full text-[13px]"
            >
              <option value="auto">{t(copy.wireAuto)}</option>
              <option value="effort">{t(copy.wireEffort)}</option>
              <option value="budget">{t(copy.wireBudget)}</option>
              <option value="none">{t(copy.wireNone)}</option>
            </select>
            <p className="mt-1.5 px-0.5 text-[11.5px] leading-relaxed text-ink-faint">
              {t(WIRE_HINTS[wire])}
            </p>
          </Field>
        ) : null}

        {editing ? (
          <p className="-mt-1 px-1 text-[11.5px] leading-relaxed text-ink-faint">
            {t(copy.apiKeyEditNote)}
          </p>
        ) : null}
      </div>

      {notice ? <p className="mt-2 px-1 text-[12px] text-working">{notice}</p> : null}
      {error ? <p className="mt-2 px-1 text-[12px] leading-relaxed text-ink-muted">{error}</p> : null}

      <div className="mt-3 flex justify-end gap-2">
        <Button size="sm" onClick={onCancel}>
          {t(copy.cancel)}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={busy || (!editing && !baseUrl.trim()) || (!editing && !apiKey.trim())}
          onClick={() => void save()}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} /> : null}
          {t(copy.save)}
        </Button>
      </div>
    </div>
  )
}

/**
 * One provider's model list.
 *
 * Two independent actions live here and are deliberately separate controls:
 * fetching the catalogue, and testing that the models in it actually answer.
 * A model that lists but does not respond is the common failure of a gateway,
 * so the test has to be the user's to run, not a step folded into saving.
 */
function ProviderDetail({
  provider,
  onChanged,
}: {
  provider: ProviderConfig
  onChanged: () => Promise<void>
}) {
  const t = useT()
  const [models, setModels] = useState(provider.models ?? [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manual, setManual] = useState('')
  // Health-check results, keyed by model id. `'running'` while a probe is out.
  const [health, setHealth] = useState<Record<string, ProbeResult | 'running'>>({})
  const [probing, setProbing] = useState(false)

  useEffect(() => {
    setModels(provider.models ?? [])
  }, [provider.models])

  const probeOne = async (modelId: string) => {
    setHealth((previous) => ({ ...previous, [modelId]: 'running' }))
    const result = await probeModel(provider, modelId)
    setHealth((previous) => ({ ...previous, [modelId]: result }))
  }

  const probeEnabled = async () => {
    const ids = models.filter((model) => model.enabled).map((model) => model.id)
    if (!ids.length) return
    setProbing(true)
    setHealth((previous) => ({
      ...previous,
      ...Object.fromEntries(ids.map((id) => [id, 'running' as const])),
    }))
    await probeMany(provider, ids, (id, result) =>
      setHealth((previous) => ({ ...previous, [id]: result })),
    )
    setProbing(false)
  }

  const results = Object.values(health).filter(
    (entry): entry is ProbeResult => entry !== 'running',
  )
  const failed = results.filter((entry) => !entry.ok).length

  const persist = async (next: Array<{ id: string; enabled: boolean }>) => {
    setModels(next)
    await db.upsertProvider({
      id: provider.id,
      kind: provider.kind,
      name: provider.name,
      baseUrl: provider.baseUrl,
      enabled: provider.enabled,
      models: next,
    })
    await onChanged()
  }

  const refetch = async () => {
    setBusy(true)
    setError(null)
    try {
      const discovered = await fetchModels(provider.id, provider.kind, provider.baseUrl)
      const preferred = new Set(preferredModels(provider.kind, discovered))
      await persist(
        discovered.map((model) => ({
          id: model.id,
          // Keep the user's existing choices; only pre-select what is new.
          enabled: models.find((entry) => entry.id === model.id)?.enabled ?? preferred.has(model.id),
        })),
      )
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="border-t border-line bg-surface/40 px-3 py-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] text-ink-muted">
          {t(copy.modelsEnabled, { enabled: models.filter((model) => model.enabled).length, total: models.length })}
          {results.length && !probing ? (
            <span className={cn('ml-2', failed ? 'text-danger' : 'text-success')}>
              {failed ? t(copy.modelsUnavailable, { count: failed }) : t(copy.modelsAllAvailable)}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-1">
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" strokeWidth={2} /> : null}
          <Button
            size="sm"
            onClick={() => void probeEnabled()}
            disabled={probing || !models.some((model) => model.enabled)}
          >
            {probing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <Activity className="h-3.5 w-3.5" strokeWidth={1.75} />
            )}
            {t(copy.testEnabled)}
          </Button>
          <Button size="sm" onClick={() => void refetch()} disabled={busy}>
            {t(copy.fetchModels)}
          </Button>
        </div>
      </div>

      {error ? <p className="mb-2 text-[12px] text-danger">{error}</p> : null}

      <div className="max-h-[220px] overflow-y-auto rounded-[9px] border border-line bg-paper">
        {models.length === 0 ? (
          <p className="px-3 py-3 text-[12.5px] text-ink-faint">
            {t(copy.modelsEmpty)}
          </p>
        ) : (
          models.map((model) => (
            <div
              key={model.id}
              className="flex items-center gap-2.5 border-b border-line px-3 py-1.5 last:border-b-0 hover:bg-surface-hover"
            >
              {/* Only the identifying half toggles the model; the test button is
                  its own control and must not enable or disable anything. */}
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={model.enabled}
                  onChange={(event) =>
                    void persist(
                      models.map((entry) =>
                        entry.id === model.id ? { ...entry, enabled: event.target.checked } : entry,
                      ),
                    )
                  }
                  className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--ink))]"
                />
                <ModelIcon modelId={model.id} className="h-3.5 w-3.5 text-ink-muted" />
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">
                  {displayName(model.id)}
                </span>
                <span className="max-w-[140px] shrink-0 truncate font-mono text-[11px] text-ink-faint">
                  {model.id}
                </span>
              </label>
              <HealthBadge state={health[model.id]} onProbe={() => void probeOne(model.id)} />
            </div>
          ))
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5">
        <input
          value={manual}
          onChange={(event) => setManual(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return
            if (event.key !== 'Enter') return
            const id = manual.trim()
            if (!id || models.some((entry) => entry.id === id)) return
            void persist([...models, { id, enabled: true }])
            setManual('')
          }}
          placeholder={t(copy.manualModelPlaceholder)}
          spellCheck={false}
          className={cn(
            'min-w-0 flex-1 rounded-[9px] border border-line bg-paper px-2.5 py-1.5',
            'font-mono text-[12px] text-ink placeholder:text-ink-faint',
            'transition-[border-color] duration-[var(--dur-instant)] focus:border-line-strong',
          )}
        />
      </div>
    </div>
  )
}

/**
 * One model's health: a test button, a spinner while probing, then the latency
 * or the failure. The failure text lives in the tooltip so a long upstream
 * message does not wreck the row.
 *
 * Always visible rather than revealed on hover: a hover-only control reads as
 * decoration, and testing a model is something the user comes here to do.
 */
function HealthBadge({
  state,
  onProbe,
}: {
  state: ProbeResult | 'running' | undefined
  onProbe: () => void
}) {
  const t = useT()

  if (state === 'running') {
    return (
      <span className="flex w-[58px] shrink-0 justify-end">
        <Loader2 className="h-3.5 w-3.5 animate-spin text-ink-faint" strokeWidth={2} />
      </span>
    )
  }

  const failed = state && !state.ok
  return (
    <Tooltip
      label={
        !state
          ? t(copy.probeHint)
          : state.ok
            ? t(copy.probeOk, { latency: formatLatency(state.ms) })
            : state.error
      }
    >
      <button
        type="button"
        onClick={onProbe}
        className={cn(
          'flex w-[58px] shrink-0 items-center justify-end gap-1.5 rounded-[6px] px-1.5 py-0.5',
          'text-[11.5px] tabular-nums',
          'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
          'hover:bg-surface-active',
          failed ? 'text-danger' : 'text-ink-faint hover:text-ink',
        )}
      >
        {state ? (
          <>
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full',
                state.ok ? 'bg-success' : 'bg-danger',
              )}
              aria-hidden
            />
            {state.ok ? formatLatency(state.ms) : t(copy.unavailable)}
          </>
        ) : (
          t(copy.test)
        )}
      </button>
    </Tooltip>
  )
}

function formatLatency(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1_000).toFixed(1)}s`
}

/**
 * What each depth setting sends.
 *
 * The labels name the field rather than describing it, because the person who
 * needs this panel is the one reading their server's error message.
 */
const WIRE_HINTS: Record<ReasoningWire, Entry> = {
  auto: copy.wireHintAuto,
  effort: copy.wireHintEffort,
  budget: copy.wireHintBudget,
  none: copy.wireHintNone,
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function SearchSection() {
  const t = useT()
  const [names, setNames] = useState<string[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const reload = async () => setNames(await listSecretNames())
  useEffect(() => {
    void reload()
  }, [])

  return (
    <div className="p-5">
      <h2 className="text-[15px] font-semibold text-ink">{t(copy.sectionSearch)}</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        {t(copy.searchIntro)}
      </p>

      <div className="mt-4 flex flex-col gap-3">
        {SEARCH_ADAPTERS.map((adapter) => {
          const secretName = `provider:search:${adapter.id}`
          const configured = names.includes(secretName)
          const value = drafts[adapter.id] ?? ''

          return (
            <div key={adapter.id} className="rounded-[var(--radius-md)] border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <BrandIcon brand={adapter.id} className="h-[15px] w-[15px] text-ink-soft" />
                <span className="text-[13px] font-medium text-ink">{adapter.label}</span>
                {configured ? (
                  <span className="flex items-center gap-1 text-[11.5px] text-success">
                    <Check className="h-3 w-3" strokeWidth={2.5} />
                    {t(copy.configured)}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="password"
                  value={value}
                  onChange={(event) =>
                    setDrafts((previous) => ({ ...previous, [adapter.id]: event.target.value }))
                  }
                  placeholder={configured ? t(copy.searchKeySavedPlaceholder) : adapter.keyHint}
                  spellCheck={false}
                  autoComplete="off"
                  className={cn(
                    'min-w-0 flex-1 rounded-[9px] border border-line bg-paper px-2.5 py-1.5',
                    'font-mono text-[12px] text-ink placeholder:text-ink-faint',
                    'transition-[border-color] duration-[var(--dur-instant)] focus:border-line-strong',
                  )}
                />
                <Button
                  size="sm"
                  disabled={!value.trim()}
                  onClick={async () => {
                    await setSecret(secretName, value.trim(), '')
                    setDrafts((previous) => ({ ...previous, [adapter.id]: '' }))
                    await reload()
                  }}
                >
                  {t(copy.save)}
                </Button>
                {configured ? (
                  <Button
                    size="icon-sm"
                    onClick={async () => {
                      await deleteSecret(secretName)
                      await reload()
                    }}
                    aria-label={t(copy.removeSearchKey, { name: adapter.label })}
                  >
                    <Trash2 className="h-[15px] w-[15px]" strokeWidth={1.75} />
                  </Button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// New-conversation defaults
// ---------------------------------------------------------------------------

// Brand names read the same in every language.
const SEARCH_LABELS: Array<[SearchMode, Entry]> = [
  ['none', copy.searchOff],
  ['native', copy.searchNative],
  ['tavily', { en: 'Tavily', zh: 'Tavily' }],
  ['brave', { en: 'Brave', zh: 'Brave' }],
  ['exa', { en: 'Exa', zh: 'Exa' }],
]

const modelKey = (model: ModelRef) => `${model.providerId}::${model.modelId}`
const sameModel = (a: ModelRef, b: ModelRef) => a.providerId === b.providerId && a.modelId === b.modelId

/**
 * How a new conversation starts.
 *
 * Only new ones: an existing conversation reopens with the composer as its own
 * last send left it, and these never reach into it. A saved model that has
 * since been switched off stays listed, marked, so it can be cleared rather
 * than silently ignored.
 */
function DefaultsSection() {
  const t = useT()
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  const models = useAvailableModels()
  const compare = settings.defaultCompareModels ?? []
  const primary = settings.defaultModel
  const available = (model: ModelRef) => models.some((entry) => sameModel(entry, model))

  // A switched-off default stays visible until the user clears it.
  const missing = [primary, ...compare].filter(
    (model): model is ModelRef => Boolean(model) && !available(model!),
  )
  const byProvider = useMemo(() => {
    const groups = new Map<string, typeof models>()
    for (const model of models) groups.set(model.providerName, [...(groups.get(model.providerName) ?? []), model])
    return [...groups.entries()]
  }, [models])

  const toggleCompare = (model: ModelRef) =>
    setSettings({
      defaultCompareModels: compare.some((entry) => sameModel(entry, model))
        ? compare.filter((entry) => !sameModel(entry, model))
        : [...compare, model],
    })

  return (
    <div className="p-5">
      <h2 className="text-[15px] font-semibold text-ink">{t(copy.sectionDefaults)}</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        {t(copy.defaultsIntro)}
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <Field label={t(copy.defaultModel)}>
          <select
            value={primary ? modelKey(primary) : ''}
            onChange={(event) => {
              const next = [...models, ...missing].find((model) => modelKey(model) === event.target.value)
              setSettings({
                defaultModel: next ? { providerId: next.providerId, modelId: next.modelId } : undefined,
                // The answering model is never also its own comparison.
                defaultCompareModels: next ? compare.filter((entry) => !sameModel(entry, next)) : compare,
              })
            }}
            className="w-full text-[13px]"
          >
            <option value="">{t(copy.followLastModel)}</option>
            {byProvider.map(([providerName, entries]) => (
              <optgroup key={providerName} label={providerName}>
                {entries.map((model) => (
                  <option key={modelKey(model)} value={modelKey(model)}>
                    {displayName(model.modelId)}
                  </option>
                ))}
              </optgroup>
            ))}
            {primary && !available(primary) ? (
              <option value={modelKey(primary)}>{t(copy.disabledSuffix, { name: displayName(primary.modelId) })}</option>
            ) : null}
          </select>
        </Field>

        <Field label={t(copy.defaultCompareModels, { max: MAX_LANES - 1 })}>
          <div className="max-h-[220px] overflow-y-auto rounded-[9px] border border-line p-1">
            {models.length === 0 && !missing.length ? (
              <p className="px-2 py-2 text-[12.5px] text-ink-faint">{t(copy.enableModelsFirst)}</p>
            ) : null}
            {[...models, ...compare.filter((model) => !available(model))].map((model) => {
              const isPrimary = primary ? sameModel(primary, model) : false
              const checked = compare.some((entry) => sameModel(entry, model))
              const full = !checked && compare.length >= MAX_LANES - 1
              const off = !available(model)
              return (
                <label
                  key={modelKey(model)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[7px] px-2 py-1.5 text-[13px]',
                    isPrimary || full ? 'cursor-default text-ink-faint' : 'cursor-pointer text-ink-soft hover:bg-surface-hover',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={isPrimary || full}
                    onChange={() => toggleCompare({ providerId: model.providerId, modelId: model.modelId })}
                    className="h-3.5 w-3.5 accent-[hsl(var(--ink))]"
                  />
                  <ModelIcon modelId={model.modelId} className="h-3.5 w-3.5" />
                  <span className="min-w-0 flex-1 truncate">{displayName(model.modelId)}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">
                    {isPrimary
                      ? t(copy.defaultModel)
                      : off
                        ? t(copy.disabled)
                        : models.find((entry) => sameModel(entry, model))?.providerName}
                  </span>
                </label>
              )
            })}
          </div>
          <p className="mt-1.5 px-0.5 text-[11.5px] leading-relaxed text-ink-faint">
            {t(copy.compareHint)}
          </p>
        </Field>

        <Field label={t(copy.sectionSearch)}>
          <select
            value={settings.defaultSearch}
            onChange={(event) => setSettings({ defaultSearch: event.target.value as PersistedSettings['defaultSearch'] })}
            className="w-full text-[13px]"
          >
            {SEARCH_LABELS.map(([mode, label]) => (
              <option key={mode} value={mode}>
                {t(label)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t(copy.reasoning)}>
          <select
            value={settings.defaultReasoning ?? 'medium'}
            onChange={(event) => setSettings({ defaultReasoning: event.target.value as ReasoningLevel })}
            className="w-full text-[13px]"
          >
            {(Object.keys(REASONING_LABELS) as ReasoningLevel[]).map((level) => (
              <option key={level} value={level}>
                {REASONING_LABELS[level]}
              </option>
            ))}
          </select>
          <p className="mt-1.5 px-0.5 text-[11.5px] leading-relaxed text-ink-faint">
            {t(copy.reasoningFallbackHint)}
          </p>
        </Field>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------

function GeneralSection() {
  const t = useT()
  const settings = useStore((state) => state.settings)
  const setSettings = useStore((state) => state.setSettings)
  useTheme(settings.theme)

  return (
    <div className="p-5">
      <h2 className="text-[15px] font-semibold text-ink">{t(copy.sectionGeneral)}</h2>

      <div className="mt-4 flex flex-col gap-4">
        <Field label={t(copy.appearance)}>
          <div className="flex gap-1">
            {(['light', 'dark', 'system'] as ThemePreference[]).map((theme) => (
              <button
                key={theme}
                type="button"
                onClick={() => setSettings({ theme })}
                className={cn(
                  'rounded-[9px] border px-3 py-1.5 text-[12.5px]',
                  'transition-[background-color,border-color] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                  settings.theme === theme
                    ? 'border-line-strong bg-surface-active font-medium text-ink'
                    : 'border-line text-ink-soft hover:bg-surface-hover',
                )}
              >
                {t(theme === 'light' ? copy.themeLight : theme === 'dark' ? copy.themeDark : copy.themeSystem)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t(copy.uiLanguage)}>
          <div className="flex gap-1">
            {(['zh', 'en'] as Language[]).map((language) => (
              <button
                key={language}
                type="button"
                onClick={() => setSettings({ uiLanguage: language })}
                className={cn(
                  'rounded-[9px] border px-3 py-1.5 text-[12.5px]',
                  'transition-[background-color,border-color] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                  (settings.uiLanguage ?? 'zh') === language
                    ? 'border-line-strong bg-surface-active font-medium text-ink'
                    : 'border-line text-ink-soft hover:bg-surface-hover',
                )}
              >
                {t(language === 'zh' ? copy.uiLanguageZh : copy.uiLanguageEn)}
              </button>
            ))}
          </div>
        </Field>

        <Field label={t(copy.systemPrompt)}>
          <textarea
            value={settings.systemPrompt}
            onChange={(event) => setSettings({ systemPrompt: event.target.value })}
            rows={5}
            placeholder={t(copy.systemPromptPlaceholder)}
            className={cn(
              'w-full rounded-[9px] border border-line bg-paper px-2.5 py-2',
              'text-[13px] leading-[1.6] text-ink placeholder:text-ink-faint',
              'transition-[border-color] duration-[var(--dur-instant)] focus:border-line-strong',
            )}
          />
        </Field>

        <label className="flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            checked={settings.autoTitle}
            onChange={(event) => setSettings({ autoTitle: event.target.checked })}
            className="h-3.5 w-3.5 accent-[hsl(var(--ink))]"
          />
          <span className="text-[13px] text-ink-soft">{t(copy.autoTitle)}</span>
        </label>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shortcuts
// ---------------------------------------------------------------------------

/** Fixed behaviour that is not rebindable, listed under the editable ones. */
const FIXED_KEYS: Array<{ keys: string; label: Entry; hint: Entry }> = [
  { keys: 'Enter', label: copy.fixedSend, hint: copy.fixedSendHint },
  { keys: '⇧ Enter', label: copy.fixedNewline, hint: copy.fixedNewlineHint },
]

/**
 * Shortcut editor.
 *
 * Binding a key is done by pressing it — there is no text field, because a text
 * field would have to re-implement everything the keyboard already knows about
 * modifiers, and because "what you pressed is what you get" is the only rule a
 * user can hold in their head. The capture is a real listener on the row, so
 * what it shows is exactly what the app will match.
 */
function ShortcutsSection() {
  const t = useT()
  const shortcuts = useStore((state) => state.settings.shortcuts)
  const setSettings = useStore((state) => state.setSettings)
  const [recording, setRecording] = useState<ShortcutId | null>(null)
  const [error, setError] = useState<string | null>(null)

  const resolved = useMemo(() => resolveShortcuts(shortcuts), [shortcuts])

  const bind = (id: ShortcutId, keys: string) => {
    const conflict = findConflict(resolved, keys, id)
    const conflictLabel = conflict && SHORTCUTS.find((entry) => entry.id === conflict)?.label
    setError(conflictLabel ? t(copy.shortcutConflict, { name: t(conflictLabel) }) : null)
    setSettings({ shortcuts: { ...resolved, [id]: keys } })
  }

  const reset = (id: ShortcutId) => {
    setError(null)
    const entry = SHORTCUTS.find((candidate) => candidate.id === id)
    if (!entry) return
    setSettings({ shortcuts: { ...resolved, [id]: entry.defaultKeys } })
  }

  return (
    <div className="p-5">
      <header className="mb-4">
        <h2 className="text-[15px] font-semibold text-ink">{t(copy.sectionShortcuts)}</h2>
        <p className="mt-0.5 text-[12.5px] text-ink-muted">
          {t(copy.shortcutsIntro)}
        </p>
      </header>

      {error ? <p className="mb-2 text-[12px] text-danger">{error}</p> : null}

      <ul className="flex flex-col gap-1">
        {SHORTCUTS.map((entry) => {
          const keys = resolved[entry.id] ?? entry.defaultKeys
          const isRecording = recording === entry.id

          return (
            <li
              key={entry.id}
              className="flex items-center justify-between gap-3 rounded-[9px] px-1 py-1.5"
            >
              <span className="min-w-0">
                <span className="block text-[13px] text-ink-soft">{t(entry.label)}</span>
                <span className="block text-[11.5px] text-ink-faint">{t(entry.hint)}</span>
              </span>

              {entry.fixed ? (
                <kbd className="shrink-0 rounded-[6px] border border-line bg-surface px-2 py-0.5 font-mono text-[11.5px] text-ink-muted">
                  Esc
                </kbd>
              ) : (
                <span className="flex shrink-0 items-center gap-1">
                  {isRecording ? (
                    <KeyCapture
                      onCapture={(keys) => {
                        bind(entry.id, keys)
                        setRecording(null)
                      }}
                      onCancel={() => setRecording(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setError(null)
                        setRecording(entry.id)
                      }}
                      className={cn(
                        'flex items-center gap-1 rounded-[7px] border px-2 py-1',
                        'transition-colors duration-[var(--dur-instant)] ease-[var(--ease-out)]',
                        'border-line bg-surface hover:border-line-strong',
                      )}
                    >
                      {formatBinding(keys).map((glyph) => (
                        <kbd
                          key={glyph}
                          className="font-mono text-[11.5px] text-ink-muted"
                        >
                          {glyph}
                        </kbd>
                      ))}
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => reset(entry.id)}
                    disabled={keys === entry.defaultKeys}
                    aria-label={t(copy.resetShortcut, { name: t(entry.label) })}
                    className={cn(
                      'flex h-6 w-6 items-center justify-center rounded-[6px] text-ink-faint',
                      'transition-colors duration-[var(--dur-instant)]',
                      'hover:text-ink disabled:pointer-events-none disabled:opacity-25',
                    )}
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </span>
              )}
            </li>
          )
        })}
      </ul>

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-[12px] font-medium text-ink-soft">{t(copy.fixedBehaviour)}</p>
        <ul className="flex flex-col gap-1">
          {FIXED_KEYS.map((entry) => (
            <li
              key={entry.keys}
              className="flex items-center justify-between rounded-[9px] px-1 py-1.5"
            >
              <span className="min-w-0">
                <span className="block text-[13px] text-ink-soft">{t(entry.label)}</span>
                <span className="block text-[11.5px] text-ink-faint">{t(entry.hint)}</span>
              </span>
              <kbd className="shrink-0 rounded-[6px] border border-line bg-surface px-2 py-0.5 font-mono text-[11.5px] text-ink-muted">
                {entry.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * Records the next keystroke.
 *
 * Listens on `keydown` while it is mounted and swallows the event, so the key
 * being bound cannot also trigger the action it is being bound to. Modifier-only
 * presses are ignored and Escape cancels rather than binding, which is what a
 * user expects from a capture field.
 */
function KeyCapture({
  onCapture,
  onCancel,
}: {
  onCapture: (keys: string) => void
  onCancel: () => void
}) {
  const t = useT()
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()

      if (event.key === 'Escape') {
        onCancel()
        return
      }
      // A modifier on its own is not a binding; wait for the key it will modify.
      if (['Meta', 'Control', 'Alt', 'Shift'].includes(event.key)) return

      const binding = bindingFromEvent(event)
      if (!binding || binding === event.key.toLowerCase()) {
        onCancel()
        return
      }
      onCapture(binding)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onCapture, onCancel])

  return (
    <span className="flex items-center gap-1.5 rounded-[7px] border border-line-strong bg-surface-active px-2 py-1">
      <span className="shimmer text-[11.5px] text-ink-soft">{t(copy.pressKeys)}</span>
      <span className="text-[11px] text-ink-faint">{t(copy.escToCancel)}</span>
    </span>
  )
}

// ---------------------------------------------------------------------------

/** A labelled form row with consistent input chrome. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block px-0.5 text-[12px] font-medium text-ink-soft">{label}</span>
      <div
        className={cn(
          '[&_input]:rounded-[9px] [&_input]:border [&_input]:border-line [&_input]:bg-paper',
          '[&_input]:px-2.5 [&_input]:py-1.5 [&_input]:text-ink',
          '[&_select]:rounded-[9px] [&_select]:border [&_select]:border-line [&_select]:bg-paper',
          '[&_select]:px-2.5 [&_select]:py-1.5 [&_select]:text-ink',
          '[&_input:focus]:border-line-strong [&_select:focus]:border-line-strong',
          '[&_input]:transition-[border-color] [&_input]:duration-[var(--dur-instant)]',
        )}
      >
        {children}
      </div>
    </label>
  )
}
