"use client";

import { useEffect, useState } from "react";

/**
 * Relógio do navegador, `null` até a montagem.
 *
 * O prazo com hora é hora de parede, e o servidor roda em UTC. Comparar com o
 * relógio dele marcaria como atrasada uma tarefa ainda no prazo para quem está
 * no Brasil — e, pior, o HTML vindo do servidor discordaria do que o React
 * desenha ao hidratar, que é exatamente a receita de um erro de hidratação.
 *
 * Devolver `null` na primeira renderização faz servidor e cliente produzirem o
 * mesmo resultado (comparação só por data). Depois de montado, o relógio real
 * entra e a comparação ganha a precisão da hora.
 *
 * A atualização de minuto em minuto existe para o aviso "Atrasado" aparecer
 * sozinho quando o prazo vence com a tela aberta.
 */
export function useNow(intervaloMs = 60_000): Date | null {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), intervaloMs);
    return () => clearInterval(id);
  }, [intervaloMs]);

  return now;
}
