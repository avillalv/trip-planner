/** Temporary page for sections that are built in later phases. */
export function SectionPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 md:px-10 md:py-12">
      <h1 className="type-title">{title}</h1>
      <p className="mt-3 max-w-prose text-ink-soft">{description}</p>
    </div>
  )
}
