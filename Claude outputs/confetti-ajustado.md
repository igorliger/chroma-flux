# Confete maior, mais longo e mais visível (canvas-confetti)

## Configuração original típica (exemplo comum)
```js
import confetti from 'canvas-confetti';

function celebrarConclusao() {
  confetti({
    particleCount: 100,
    spread: 70,
    origin: { y: 0.6 },
  });
}
```

## Versão ajustada — maior, mais longa e mais visível

Duas abordagens, dependendo do efeito que você quer:

### Opção A — Uma explosão só, porém bem maior
```js
import confetti from 'canvas-confetti';

function celebrarConclusao() {
  confetti({
    particleCount: 300,       // de 100 → 300 (muito mais confete)
    spread: 160,               // de 70 → 160 (espalha bem mais pros lados)
    startVelocity: 55,         // partículas saem com mais força
    ticks: 300,                // partículas demoram mais pra sumir (mais "longa")
    gravity: 0.8,              // cai um pouco mais devagar, fica mais tempo na tela
    scalar: 1.4,                // partículas maiores (tamanho)
    origin: { y: 0.6 },
    zIndex: 9999,               // garante que fique por cima de tudo
  });
}
```

### Opção B — Várias rajadas ao longo de alguns segundos (mais "showzão")
```js
import confetti from 'canvas-confetti';

function celebrarConclusao() {
  const duracaoMs = 3000; // dura 3 segundos (ajuste à vontade)
  const fimEm = Date.now() + duracaoMs;

  const intervalo = setInterval(() => {
    const tempoRestante = fimEm - Date.now();

    if (tempoRestante <= 0) {
      clearInterval(intervalo);
      return;
    }

    const quantidadeParticulas = 60 * (tempoRestante / duracaoMs);

    // Dispara de dois pontos (esquerda e direita) para cobrir mais tela
    confetti({
      particleCount: quantidadeParticulas,
      spread: 100,
      startVelocity: 45,
      scalar: 1.3,
      origin: { x: Math.random() * 0.3, y: Math.random() * 0.4 + 0.2 },
      zIndex: 9999,
    });
    confetti({
      particleCount: quantidadeParticulas,
      spread: 100,
      startVelocity: 45,
      scalar: 1.3,
      origin: { x: 0.7 + Math.random() * 0.3, y: Math.random() * 0.4 + 0.2 },
      zIndex: 9999,
    });
  }, 200);
}
```

## O que cada parâmetro faz (pra você ajustar do seu jeito)
- `particleCount`: quantidade de confetes (mais = visualmente "maior")
- `spread`: ângulo de abertura do lançamento em graus (mais = cobre mais tela)
- `startVelocity`: velocidade inicial (mais = confete voa mais longe/alto)
- `ticks`: "tempo de vida" de cada partícula antes de sumir (mais = anima mais tempo)
- `gravity`: força da gravidade, valores menores que 1 fazem cair mais devagar (fica mais tempo visível)
- `scalar`: escala/tamanho de cada partícula de confete
- `zIndex`: garante que o confete apareça por cima de outros elementos da UI

Recomendo a Opção A se você só quer uma explosão mais chamativa no momento exato de concluir a tarefa. Recomendo a Opção B se quiser uma celebração mais "de verdade", com confete caindo por alguns segundos.
