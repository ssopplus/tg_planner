import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // postgres не бандлит webpack/turbopack: иначе в Worker попадает сборка для Node поверх эмуляции
  // net/tls, и запросы падают с CONNECTION_CLOSED. Внешний пакет подключает esbuild OpenNext с условием
  // workerd (cf/src — cloudflare:sockets). Патч записи кусками — patches/postgres@3.4.8.patch.
  serverExternalPackages: ["postgres"],
};

export default nextConfig;
