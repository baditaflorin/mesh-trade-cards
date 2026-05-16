import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-trade-cards",
  description: "Each peer is dealt one unique collectible card — trade via QR + mutual confirm",
  accentHex: "#7e22ce",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});
