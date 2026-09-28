import { CheckCircle2, Circle, Flag, ListTree, Plus, Search } from "lucide-react";

/**
 * Notebook com a interface do Chroma Flux, para o hero da landing pública.
 *
 * Não é uma captura de tela real: os dados aqui são fictícios, de propósito
 * (a interface real mostraria tarefas e nomes de verdade da equipe de quem
 * está vendo a página — não é isso que deve aparecer numa página pública).
 * O visual, porém, é o mesmo — cores, selos de prioridade, prazo e avatar
 * seguem exatamente o que existe hoje em `components/task/task-list.tsx`.
 */

type CardDemo = {
  titulo: string;
  prioridade: "baixa" | "media" | "alta" | "urgente";
  prazo?: string;
  subtarefas?: string;
  pessoa: { iniciais: string; cor: string };
};

const PRIORIDADE: Record<CardDemo["prioridade"], { dot: string; label: string }> = {
  baixa: { dot: "bg-slate-400", label: "Baixa" },
  media: { dot: "bg-sky-400", label: "Média" },
  alta: { dot: "bg-amber-400", label: "Alta" },
  urgente: { dot: "bg-rose-400", label: "Urgente" },
};

const COLUNAS: { titulo: string; cards: CardDemo[] }[] = [
  {
    titulo: "A fazer",
    cards: [
      {
        titulo: "Alinhar prioridades da sprint",
        prioridade: "alta",
        prazo: "Hoje",
        pessoa: { iniciais: "AB", cor: "bg-violet-500" },
      },
      {
        titulo: "Revisar proposta do cliente",
        prioridade: "media",
        prazo: "Amanhã",
        pessoa: { iniciais: "LT", cor: "bg-sky-500" },
      },
      {
        titulo: "Organizar onboarding do time",
        prioridade: "baixa",
        subtarefas: "1/4",
        pessoa: { iniciais: "HS", cor: "bg-emerald-500" },
      },
    ],
  },
  {
    titulo: "Em andamento",
    cards: [
      {
        titulo: "Relatório de resultados mensal",
        prioridade: "urgente",
        prazo: "Hoje, 17:00",
        pessoa: { iniciais: "SA", cor: "bg-amber-500" },
      },
      {
        titulo: "Ajustes no processo de aprovação",
        prioridade: "media",
        subtarefas: "3/5",
        pessoa: { iniciais: "IT", cor: "bg-rose-500" },
      },
    ],
  },
  {
    titulo: "Concluído",
    cards: [
      {
        titulo: "Reunião de planejamento",
        prioridade: "media",
        pessoa: { iniciais: "AB", cor: "bg-violet-500" },
      },
      {
        titulo: "Enviar convites da equipe",
        prioridade: "baixa",
        pessoa: { iniciais: "LT", cor: "bg-sky-500" },
      },
    ],
  },
];

function TaskCard({ card }: { card: CardDemo }) {
  const done = card.titulo === "Reunião de planejamento" || card.titulo === "Enviar convites da equipe";
  const p = PRIORIDADE[card.prioridade];

  return (
    <div className="rounded-xl border border-white/[0.06] bg-[#161927] p-3 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset]">
      <div className="flex items-start gap-2">
        {done ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-400" aria-hidden />
        ) : (
          <Circle className="mt-0.5 size-4 shrink-0 text-white/20" aria-hidden />
        )}
        <p className={`text-[13px] font-medium leading-snug ${done ? "text-white/40 line-through" : "text-white/90"}`}>
          {card.titulo}
        </p>
      </div>
      <div className="mt-2.5 flex flex-wrap items-center gap-2 pl-6 text-[11px] text-white/40">
        <span className="inline-flex items-center gap-1">
          <span className={`size-1.5 rounded-full ${p.dot}`} aria-hidden />
          {p.label}
        </span>
        {card.prazo && <span>{card.prazo}</span>}
        {card.subtarefas && (
          <span className="inline-flex items-center gap-1">
            <ListTree className="size-3" aria-hidden />
            {card.subtarefas}
          </span>
        )}
        <span
          className={`ml-auto flex size-5 items-center justify-center rounded-full text-[9px] font-semibold text-white/90 ring-2 ring-[#161927] ${card.pessoa.cor}`}
        >
          {card.pessoa.iniciais}
        </span>
      </div>
    </div>
  );
}

/** Largura "de projeto" do notebook — o `ScaleToFit` encolhe a partir dela. */
export const PRODUCT_MOCKUP_WIDTH = 640;

export function ProductMockup() {
  return (
    <div className="relative" aria-hidden="true">
      {/* Iluminação discreta atrás do notebook — nunca na frente do conteúdo. */}
      <div className="pointer-events-none absolute -inset-x-10 -inset-y-16 -z-10">
        <div className="absolute right-0 top-0 size-[26rem] rounded-full bg-[radial-gradient(circle,_rgba(139,92,246,0.35),_transparent_70%)] blur-2xl" />
        <div className="absolute bottom-0 left-10 size-80 rounded-full bg-[radial-gradient(circle,_rgba(59,130,246,0.18),_transparent_70%)] blur-2xl" />
      </div>

      {/* Corpo do notebook */}
      <div className="relative rounded-2xl border border-white/10 bg-gradient-to-b from-[#1b1e2e] to-[#101223] p-2 shadow-2xl shadow-black/50 [transform:perspective(1400px)_rotateY(-4deg)_rotateX(1deg)]">
        <div className="overflow-hidden rounded-xl border border-white/10 bg-[#0d0f1a]">
          {/* Barra de título */}
          <div className="flex items-center gap-1.5 border-b border-white/[0.06] bg-[#11131f] px-3 py-2">
            <span className="size-2.5 rounded-full bg-rose-400/70" />
            <span className="size-2.5 rounded-full bg-amber-400/70" />
            <span className="size-2.5 rounded-full bg-emerald-400/70" />
            <span className="ml-3 truncate text-[11px] text-white/30">chromaflux.com.br</span>
          </div>

          <div className="flex">
            {/* Barra lateral, resumida */}
            <div className="hidden w-36 shrink-0 border-r border-white/[0.06] bg-[#0f111c] p-3 sm:block">
              <div className="mb-4 flex items-center gap-1.5">
                <span className="size-2 rounded-full bg-gradient-to-br from-orange-400 via-fuchsia-500 to-violet-500" />
                <span className="text-[11px] font-semibold text-white/80">Chroma Flux</span>
              </div>
              {["Tarefas", "Espaços", "Equipe", "Calendário"].map((item, i) => (
                <div
                  key={item}
                  className={`mb-1 rounded-md px-2 py-1.5 text-[11px] ${
                    i === 0 ? "bg-violet-500/15 font-medium text-violet-300" : "text-white/40"
                  }`}
                >
                  {item}
                </div>
              ))}
            </div>

            {/* Conteúdo: quadro Kanban */}
            <div className="min-w-0 flex-1 p-3.5">
              <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-1.5 rounded-lg bg-white/[0.04] px-2.5 py-1.5 text-[11px] text-white/30">
                  <Search className="size-3" />
                  Buscar tarefas…
                </div>
                <span className="flex items-center gap-1 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-500 px-2.5 py-1.5 text-[11px] font-medium text-white">
                  <Plus className="size-3" />
                  Nova tarefa
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {COLUNAS.map((coluna) => (
                  <div key={coluna.titulo} className="min-w-0">
                    <div className="mb-2 flex items-center gap-1.5 px-0.5 text-[11px] font-medium text-white/50">
                      <Flag className="size-3" />
                      {coluna.titulo}
                      <span className="ml-auto text-white/20">{coluna.cards.length}</span>
                    </div>
                    <div className="space-y-2">
                      {coluna.cards.map((card) => (
                        <TaskCard key={card.titulo} card={card} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* "Base" do notebook, sugerindo o teclado sem desenhar um. */}
      <div className="relative -mt-1 h-4 rounded-b-2xl bg-gradient-to-b from-[#22263a] to-[#14162238] shadow-lg" />
    </div>
  );
}
