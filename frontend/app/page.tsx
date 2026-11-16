import Link from "next/link";

const featureCards = [
  {
    title: "Upload + AI Edit",
    text: "Drop in raw footage, describe the outcome, and let Clayme transform it into viral-ready edits.",
  },
  {
    title: "Track Jobs Live",
    text: "Monitor progress, inspect job IDs, and keep production moving without guessing what the backend is doing.",
  },
  {
    title: "Manage Outputs",
    text: "Store project history, reopen generated media, and build toward a monetizable creator SaaS workflow.",
  },
];

export default function HomePage() {
  return (
    <main className="clayme-shell min-h-screen px-4 py-4">
      <section className="glass-panel mx-auto flex min-h-[calc(100vh-2rem)] max-w-7xl flex-col rounded-[36px] px-6 py-6 sm:px-8 lg:px-10">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-[var(--accent)]">Clayme AI</p>
            <h1 className="section-title mt-3 text-3xl font-semibold sm:text-4xl">Creator Growth Engine</h1>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/auth"
              className="rounded-full border border-[var(--line-strong)] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white hover:text-slate-950"
            >
              Login
            </Link>
            <Link
              href="/dashboard"
              className="rounded-full bg-[var(--accent)] px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-[var(--accent-strong)]"
            >
              Open Dashboard
            </Link>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-10 py-10 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <p className="text-sm uppercase tracking-[0.35em] text-[var(--accent-warm)]">All-in-one AI SaaS MVP</p>
            <h2 className="section-title mt-5 max-w-4xl text-5xl font-semibold leading-none sm:text-7xl">
              Turn any raw video or idea into content built to spread.
            </h2>
            <p className="muted mt-7 max-w-2xl text-lg leading-8">
              Clayme combines upload, AI editing, generation, job tracking, and creator history into one premium workflow designed for speed and scale.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/dashboard/upload"
                className="rounded-2xl bg-white px-6 py-4 font-semibold text-slate-950 transition hover:bg-slate-200"
              >
                Launch AI Editor
              </Link>
              <Link
                href="/video"
                className="rounded-2xl border border-[var(--line-strong)] px-6 py-4 font-semibold text-white transition hover:bg-white hover:text-slate-950"
              >
                Open Video Lab
              </Link>
            </div>
          </div>

          <div className="grid gap-4">
            {featureCards.map((card, index) => (
              <div
                key={card.title}
                className={`rounded-[28px] border border-[var(--line)] p-6 ${
                  index === 1 ? "bg-[rgba(124,240,200,0.09)]" : "bg-black/20"
                }`}
              >
                <div className="text-xs uppercase tracking-[0.28em] text-[var(--muted)]">
                  Feature {index + 1}
                </div>
                <h3 className="mt-3 text-2xl font-semibold text-white">{card.title}</h3>
                <p className="muted mt-3 leading-7">{card.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
