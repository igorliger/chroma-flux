/**
 * Ilustração do painel de entrada: uma prévia estilizada da própria aplicação.
 *
 * É SVG desenhado aqui, e não uma foto: não há download, fica nítida em
 * qualquer densidade de tela e não depende de licença de imagem. Mostrar o
 * produto — lista, responsáveis, prioridades — diz mais a quem está entrando
 * do que uma foto de escritório genérica diria.
 *
 * Tudo em branco translúcido, porque ela assenta sobre o degradê da marca.
 * Decorativa de ponta a ponta: `aria-hidden`, já que a mensagem em texto ao
 * lado é quem carrega o conteúdo.
 */
export function AuthIllustration({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 480 340"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        {/* Brilho difuso atrás da janela, para ela não flutuar solta no fundo. */}
        <radialGradient id="brilho" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="white" stopOpacity="0.18" />
          <stop offset="100%" stopColor="white" stopOpacity="0" />
        </radialGradient>

        {/* O corpo da janela clareia de cima para baixo, como vidro fosco. */}
        <linearGradient id="vidro" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="white" stopOpacity="0.16" />
          <stop offset="100%" stopColor="white" stopOpacity="0.07" />
        </linearGradient>
      </defs>

      <ellipse cx="240" cy="150" rx="230" ry="165" fill="url(#brilho)" />

      {/* Cartão de fundo, deslocado: sugere profundidade sem sombra pesada. */}
      <rect
        x="42"
        y="34"
        width="396"
        height="250"
        rx="16"
        fill="white"
        fillOpacity="0.06"
      />

      {/* Janela principal */}
      <g transform="translate(24, 52)">
        <rect
          width="420"
          height="256"
          rx="16"
          fill="url(#vidro)"
          stroke="white"
          strokeOpacity="0.22"
        />

        {/* Barra lateral */}
        <rect width="72" height="256" rx="16" fill="white" fillOpacity="0.08" />
        <rect x="56" width="16" height="256" fill="white" fillOpacity="0.08" />
        <circle cx="24" cy="28" r="7" fill="white" fillOpacity="0.55" />
        {[62, 86, 110, 134].map((y, i) => (
          <rect
            key={y}
            x="14"
            y={y}
            width={i === 0 ? 44 : 36}
            height="8"
            rx="4"
            fill="white"
            fillOpacity={i === 0 ? 0.5 : 0.22}
          />
        ))}

        {/* Cabeçalho da lista */}
        <rect x="96" y="26" width="118" height="12" rx="6" fill="white" fillOpacity="0.6" />
        <rect x="96" y="48" width="76" height="8" rx="4" fill="white" fillOpacity="0.28" />
        <rect
          x="326"
          y="24"
          width="74"
          height="26"
          rx="13"
          fill="white"
          fillOpacity="0.85"
        />

        {/* Linhas de tarefa. A primeira aparece concluída — é o estado que a
            tela de entrada quer sugerir. */}
        {[
          { y: 76, largura: 150, feita: true },
          { y: 118, largura: 186, feita: false },
          { y: 160, largura: 132, feita: false },
          { y: 202, largura: 168, feita: false },
        ].map((linha) => (
          <g key={linha.y}>
            <rect
              x="96"
              y={linha.y}
              width="304"
              height="32"
              rx="8"
              fill="white"
              fillOpacity="0.07"
            />

            {linha.feita ? (
              <>
                <circle cx="114" cy={linha.y + 16} r="8" fill="white" fillOpacity="0.85" />
                <path
                  d={`M110 ${linha.y + 16} l3 3 5.5 -6`}
                  stroke="#4c1d95"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </>
            ) : (
              <circle
                cx="114"
                cy={linha.y + 16}
                r="7.5"
                stroke="white"
                strokeOpacity="0.45"
                strokeWidth="1.5"
              />
            )}

            <rect
              x="132"
              y={linha.y + 12}
              width={linha.largura}
              height="8"
              rx="4"
              fill="white"
              fillOpacity={linha.feita ? 0.3 : 0.55}
            />

            {/* Risco de tarefa concluída */}
            {linha.feita && (
              <rect
                x="132"
                y={linha.y + 15.5}
                width={linha.largura}
                height="1.5"
                rx="0.75"
                fill="white"
                fillOpacity="0.45"
              />
            )}

            {/* Prioridade e responsável */}
            <circle cx="348" cy={linha.y + 16} r="4" fill="white" fillOpacity="0.5" />
            <circle cx="378" cy={linha.y + 16} r="10" fill="white" fillOpacity="0.22" />
          </g>
        ))}
      </g>
    </svg>
  );
}
