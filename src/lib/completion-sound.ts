/**
 * Som curto de conclusão de tarefa.
 *
 * Sintetizado na hora pela Web Audio API, em vez de um arquivo: são dois
 * osciladores e nenhum download — o retorno sai no mesmo instante do clique,
 * sem depender de um `.mp3` que ainda estaria carregando na primeira vez.
 *
 * Duas notas em quinta ascendente (lá 5 → mi 6). Subir soa como "feito";
 * descer soaria como erro, que é justamente o oposto do que se quer marcar.
 */

/**
 * Um contexto só para toda a sessão. Os navegadores limitam quantos podem
 * existir ao mesmo tempo, e criar um por clique esgotaria a conta em poucas
 * dezenas de tarefas concluídas.
 */
let contexto: AudioContext | null = null;

function obterContexto(): AudioContext | null {
  if (typeof window === "undefined") return null;

  const Construtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!Construtor) return null;
  if (!contexto) contexto = new Construtor();
  return contexto;
}

const NOTAS = [
  { hz: 880, atraso: 0 }, // lá 5
  { hz: 1318.51, atraso: 0.09 }, // mi 6
];

const VOLUME = 0.12;

/**
 * Toca o som. Precisa ser chamado de dentro do próprio clique: os navegadores
 * só liberam áudio a partir de um gesto do usuário.
 *
 * Nunca lança — som é enfeite, e um navegador sem Web Audio (ou com o áudio
 * bloqueado) não pode derrubar a conclusão da tarefa junto.
 */
export function playCompletionSound() {
  try {
    const ctx = obterContexto();
    if (!ctx) return;

    // Depois de um tempo ocioso o contexto hiberna; sem isto o primeiro clique
    // de volta sairia mudo.
    if (ctx.state === "suspended") void ctx.resume();

    const inicio = ctx.currentTime;

    for (const nota of NOTAS) {
      const oscilador = ctx.createOscillator();
      const ganho = ctx.createGain();

      oscilador.type = "sine";
      oscilador.frequency.value = nota.hz;

      const t = inicio + nota.atraso;

      /*
        Rampas exponenciais, e nunca a zero: `exponentialRampToValueAtTime`
        rejeita o valor 0, e começar ou terminar no volume cheio produziria o
        estalo de borda que se ouve em áudio cortado na seco.
      */
      ganho.gain.setValueAtTime(0.0001, t);
      ganho.gain.exponentialRampToValueAtTime(VOLUME, t + 0.015);
      ganho.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

      oscilador.connect(ganho).connect(ctx.destination);
      oscilador.start(t);
      oscilador.stop(t + 0.25);
    }
  } catch {
    // Áudio indisponível: segue sem som.
  }
}
