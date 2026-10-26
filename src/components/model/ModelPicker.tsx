import { useMemo } from 'react'
import { Check } from 'lucide-react'

import { useStore } from '@/chat/store'
import { displayName, type ProviderConfig } from '@/providers/registry'
import { ModelIcon, ProviderIcon } from '@/components/icons/BrandIcon'
import { useT } from '@/i18n/core'
import { composer } from '@/i18n'
import {
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverLabel,
  PopoverTrigger,
} from '@/components/ui/Popover'

/**
 * The model chooser.
 *
 * Lists only providers the user has enabled and models they have ticked in
 * settings, so the menu stays short. Grouped by provider, because "which vendor"
 * is the first thing the user is deciding.
 */

export interface ModelChoice {
  providerId: string
  providerName: string
  modelId: string
  provider: ProviderConfig
}

/** Every enabled model across enabled providers. */
export function useAvailableModels(): ModelChoice[] {
  const providers = useStore((state) => state.providers)

  return useMemo(
    () =>
      providers
        .filter((provider) => provider.enabled && provider.models?.length)
        .flatMap((provider) =>
          (provider.models ?? [])
            .filter((model) => model.enabled)
            .map((model) => ({
              providerId: provider.id,
              providerName: provider.name,
              modelId: model.id,
              provider,
            })),
        ),
    [providers],
  )
}

export function ModelPicker({
  value,
  onSelect,
  trigger,
  align = 'start',
  side = 'bottom',
}: {
  value: { providerId: string; modelId: string } | null
  onSelect: (model: { providerId: string; modelId: string }) => void
  trigger: React.ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'bottom'
}) {
  const models = useAvailableModels()
  const t = useT()

  const grouped = useMemo(() => {
    const groups = new Map<string, ModelChoice[]>()
    for (const model of models) {
      const list = groups.get(model.providerName) ?? []
      list.push(model)
      groups.set(model.providerName, list)
    }
    return [...groups.entries()]
  }, [models])

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align={align} side={side} width={300} maxHeight={420}>
        {grouped.length === 0 ? (
          <div className="px-2 py-3 text-[13px] text-ink-muted">
            {t(composer.noModels)}
          </div>
        ) : (
          grouped.map(([providerName, entries], index) => (
            <div key={providerName}>
              {index > 0 ? <div className="my-1 h-px bg-line" /> : null}
              <PopoverLabel>
                <span className="flex items-center gap-1.5">
                  <ProviderIcon provider={entries[0].provider} className="h-3 w-3" />
                  {providerName}
                </span>
              </PopoverLabel>
              {entries.map((entry) => {
                const selected =
                  value?.providerId === entry.providerId && value?.modelId === entry.modelId
                return (
                  <PopoverItem
                    key={`${entry.providerId}:${entry.modelId}`}
                    selected={selected}
                    onSelect={() => onSelect({ providerId: entry.providerId, modelId: entry.modelId })}
                  >
                    <ModelIcon modelId={entry.modelId} className="h-3.5 w-3.5 text-ink-muted" />
                    <span className="min-w-0 flex-1 truncate">{displayName(entry.modelId)}</span>
                    {selected ? (
                      <Check className="h-3.5 w-3.5 shrink-0 text-ink" strokeWidth={2} />
                    ) : null}
                  </PopoverItem>
                )
              })}
            </div>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}

