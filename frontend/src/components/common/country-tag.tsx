import { cn } from '@/lib/utils'

/** A two-letter country code set like a bag tag (flag emoji don't render on Windows). */
export function CountryTag({ code, className }: { code: string | null | undefined; className?: string }) {
  if (!code) return null
  return (
    <span
      className={cn(
        'type-code inline-flex h-4 items-center rounded-[3px] border border-current/35 px-1 text-[0.6rem] leading-none text-ink-soft',
        className,
      )}
      aria-hidden="true"
    >
      {code}
    </span>
  )
}
