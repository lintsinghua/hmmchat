import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'
type Size = 'sm' | 'md' | 'icon' | 'icon-sm'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
}

/*
 * Buttons.
 *
 * No accent colour: the primary button is ink-on-paper, which is what keeps a
 * utility app looking like a tool. The hover state is a colour shift rather than
 * a shadow, so a crowded toolbar does not turn into a field of raised boxes.
 * Transitions are transform/opacity/colour only — no layout-affecting property
 * is animated.
 */
const VARIANTS: Record<Variant, string> = {
  primary:
    'bg-primary text-primary-ink hover:opacity-90 active:opacity-80 disabled:opacity-40',
  ghost:
    'text-ink-soft hover:bg-surface-hover hover:text-ink active:bg-surface-active disabled:opacity-40',
  subtle:
    'bg-surface text-ink hover:bg-surface-hover active:bg-surface-active disabled:opacity-40',
  danger:
    'text-danger hover:bg-danger/10 active:bg-danger/15 disabled:opacity-40',
}

const SIZES: Record<Size, string> = {
  sm: 'h-7 px-2.5 text-[13px] gap-1.5 rounded-[7px]',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-[9px]',
  icon: 'h-9 w-9 rounded-[9px] justify-center',
  'icon-sm': 'h-7 w-7 rounded-[7px] justify-center',
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'ghost', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'inline-flex select-none items-center font-medium',
        'transition-[background-color,opacity,color,transform] duration-[var(--dur-instant)] ease-[var(--ease-out)]',
        'active:scale-[0.98] disabled:pointer-events-none',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...props}
    />
  )
})
