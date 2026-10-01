#!/bin/bash
# Prepara a sessão do Claude Code na nuvem: instala as dependências para que
# `npm run typecheck`, `npx eslint` e `npm run build` funcionem.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"
# `npm ci` respeita o package-lock.json sem alterá-lo.
npm ci --no-audit --no-fund
