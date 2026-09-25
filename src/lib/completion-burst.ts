/**
 * Confete curto de conclusão de tarefa.
 *
 * Espelha `completion-sound.ts`: uma função disparada no clique, sem lançar
 * nunca — animação é enfeite, e uma falha aqui não pode derrubar a conclusão
 * da tarefa junto. O componente `<CompletionBurst />`, montado uma vez na
 * casca da aplicação, é quem de fato desenha; este módulo só avisa.
 */

const EMISSOR = typeof window !== "undefined" ? new EventTarget() : null;

export const EVENTO_BURST = "chroma-flux:completion-burst";

/**
 * Dispara a explosão de confete a partir do ponto do gesto que concluiu a
 * tarefa (o clique no checkbox, por exemplo) — assim ela nasce perto de onde
 * o usuário está olhando.
 *
 * Sem coordenadas, cai no centro da tela.
 */
export function fireCompletionBurst(origem?: { x: number; y: number }) {
  try {
    if (!EMISSOR) return;
    EMISSOR.dispatchEvent(new CustomEvent(EVENTO_BURST, { detail: origem ?? null }));
  } catch {
    // Sem palco montado ou navegador sem CustomEvent: segue sem confete.
  }
}

export function ouvirCompletionBurst(ouvinte: (origem: { x: number; y: number } | null) => void) {
  if (!EMISSOR) return () => {};

  const handler = (evento: Event) => {
    ouvinte((evento as CustomEvent<{ x: number; y: number } | null>).detail);
  };

  EMISSOR.addEventListener(EVENTO_BURST, handler);
  return () => EMISSOR.removeEventListener(EVENTO_BURST, handler);
}
