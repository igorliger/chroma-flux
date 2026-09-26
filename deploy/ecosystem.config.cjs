// PM2 — processo do Chroma Flux na VPS.
// `cwd` aponta para o link `current`: a cada reload, o PM2 sobe o processo
// novo já na versão que o deploy.sh acabou de publicar.
module.exports = {
  apps: [
    {
      name: "chroma-flux",
      cwd: "/opt/chroma-flux/current",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      env: { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1" },
      max_memory_restart: "800M",
      time: true,
    },
  ],
};
