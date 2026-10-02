/**
 * Esqueleto enquanto as tarefas carregam. Não mostra "lista vazia": só
 * depois que os dados chegam dá para afirmar que não há tarefas.
 */
export default function Carregando() {
  return (
    <div className="flux-backdrop flex min-h-screen" aria-busy="true">
      <div className="hidden w-64 shrink-0 bg-sidebar lg:block" aria-hidden />
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-10">
        <p role="status" className="sr-only">
          Carregando suas tarefas…
        </p>
        <div className="animate-pulse motion-reduce:animate-none" aria-hidden>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="h-9 w-56 rounded-lg bg-ink-200" />
              <div className="mt-3 h-4 w-80 max-w-full rounded bg-ink-200/70" />
            </div>
            <div className="hidden h-12 w-40 rounded-xl bg-brand-600/40 sm:block" />
          </div>
          <div className="mt-8 h-14 rounded-xl border border-ink-200 bg-surface" />
          <div className="mt-3 flex flex-wrap gap-3">
            {[56, 48, 44, 48].map((w, i) => (
              <div key={i} className="h-12 rounded-xl border border-ink-200 bg-surface" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
          <div className="mt-6 rounded-2xl border border-ink-200 bg-surface">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 border-b border-ink-200/70 px-5 py-4 last:border-0">
                <div className="size-6 rounded-full bg-ink-200" />
                <div className="flex-1 space-y-2">
                  <div className="h-4 w-2/5 rounded bg-ink-200" />
                  <div className="h-3 w-1/4 rounded bg-ink-200/70" />
                </div>
                <div className="hidden h-6 w-20 rounded-lg bg-ink-200/70 md:block" />
                <div className="size-8 rounded-full bg-ink-200" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
