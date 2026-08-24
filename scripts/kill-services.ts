import {
  ALL_SERVICE_PORTS,
  DESKTOP_PORTS,
  killPorts,
  WECHAT_BRIDGE_PORTS,
} from "./kill-ports.ts";

type Target = "desktop" | "wechat-bridge" | "all";

const TARGET_PORTS: Record<Target, readonly number[]> = {
  desktop: DESKTOP_PORTS,
  "wechat-bridge": WECHAT_BRIDGE_PORTS,
  all: ALL_SERVICE_PORTS,
};

function usage(): void {
  console.error(
    "Usage: tsx scripts/kill-services.ts <desktop|wechat-bridge|all>",
  );
}

const target = process.argv[2] as Target | undefined;
if (!target || !(target in TARGET_PORTS)) {
  usage();
  process.exit(1);
}

const killed = killPorts(TARGET_PORTS[target]);
if (killed.length === 0) {
  console.log(`[stop] no listeners on ports: ${TARGET_PORTS[target].join(", ")}`);
} else {
  console.log(`[stop] killed PIDs: ${killed.join(", ")}`);
}
