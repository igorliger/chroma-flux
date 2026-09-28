import { CheckCircle2, Circle, MessageSquare } from "lucide-react";

/**
 * Recortes menores da interface, usados nas seções de produtividade e de
 * equipe. Mesma regra do `product-mockup.tsx`: visual real, dados fictícios.
 */

const PRIORIDADE_COR: Record<string, string> = {
  Alta: "bg-amber-400",
  Urgente: "bg-rose-400",
  Média: "bg-sky-400",
  Baixa: "bg-slate-400",
};

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-md overflow-hidden rounded-2xl border border-white/10 bg-[#12141f] shadow-2xl shadow-black/40">
      <div className="flex items-center gap-1.5 border-b border-white/[0.06] px-4 py-3">
        <span className="size-2 rounded-full bg-rose-400/70" />
        <span className="size-2 rounded-full bg-amber-400/70" />
        <span className="size-2 rounded-full bg-emerald-400/70" />
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

export function TaskListSnippet() {
  const itens = [
    { titulo: "Enviar proposta comercial", prioridade: "Urgente", prazo: "Hoje, 14:00", feito: false },
    { titulo: "Revisar contrato de fornecedor", prioridade: "Alta", prazo: "Amanhã", feito: false },
    { titulo: "Organizar planejamento semanal", prioridade: "Média", prazo: "Sex, 09:00", feito: false },
    { titulo: "Atualizar cadastro de clientes", prioridade: "Baixa", prazo: undefined, feito: true },
  ];

  return (
    <Panel>
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-white/35">
        Minhas tarefas
      </p>
      <ul className="space-y-2">
        {itens.map((item) => (
          <li
            key={item.titulo}
            className="flex items-center gap-2.5 rounded-lg border border-white/[0.05] bg-white/[0.02] px-3 py-2.5"
          >
            {item.feito ? (
              <CheckCircle2 className="size-4 shrink-0 text-emerald-400" aria-hidden />
            ) : (
              <Circle className="size-4 shrink-0 text-white/20" aria-hidden />
            )}
            <span
              className={`min-w-0 flex-1 truncate text-[13px] ${
                item.feito ? "text-white/35 line-through" : "text-white/85"
              }`}
            >
              {item.titulo}
            </span>
            <span
              className={`size-1.5 shrink-0 rounded-full ${PRIORIDADE_COR[item.prioridade]}`}
              aria-hidden
            />
            {item.prazo && (
              <span className="shrink-0 text-[11px] text-white/35">{item.prazo}</span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function TeamSnippet() {
  const pessoas = [
    { iniciais: "AB", cor: "bg-violet-500", feito: true },
    { iniciais: "HS", cor: "bg-emerald-500", feito: true },
    { iniciais: "IT", cor: "bg-sky-500", feito: false },
  ];

  return (
    <Panel>
      <p className="text-[15px] font-medium text-white/90">Fechamento mensal de vendas</p>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg bg-white/[0.03] px-3 py-2 text-xs text-white/50">
        <span className="font-semibold text-white/70">2 de 3 concluíram</span>
        {pessoas.map((p) => (
          <span key={p.iniciais} className="inline-flex items-center gap-1">
            <span
              className={`flex size-4 items-center justify-center rounded-full text-[8px] font-semibold text-white ${p.cor}`}
            >
              {p.iniciais}
            </span>
            {p.feito ? "concluiu" : "em aberto"}
          </span>
        ))}
      </div>

      <div className="mt-4 space-y-2.5">
        <div className="flex items-center justify-between text-xs text-white/40">
          <span>Prazo</span>
          <span className="rounded-full bg-amber-400/10 px-2 py-0.5 font-medium text-amber-300">
            Vence hoje
          </span>
        </div>
        <div className="flex items-center gap-2 border-t border-white/[0.06] pt-3 text-xs text-white/50">
          <MessageSquare className="size-3.5" aria-hidden />
          <span>Ana Beatriz: &ldquo;Faltam só os números do time de SP.&rdquo;</span>
        </div>
      </div>
    </Panel>
  );
}
