import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { Host, type McpUiHostContext } from "./host.js";

// Host events can arrive before React mounts. The bridge keeps the latest of
// each so the app renders the initial tool result without calling the tool again.

export interface BridgeState {
  toolInput: Record<string, unknown> | null;
  toolResult: CallToolResult | null;
  context: McpUiHostContext;
  /** Bumped on every event so subscribers re-read. */
  version: number;
}

type Listener = (state: BridgeState) => void;

export function createBridge(embedded: boolean) {
  let state: BridgeState = { toolInput: null, toolResult: null, context: {}, version: 0 };
  const listeners = new Set<Listener>();
  const emit = (patch: Partial<BridgeState>) => {
    state = { ...state, ...patch, version: state.version + 1 };
    listeners.forEach((l) => l(state));
  };

  const host = embedded
    ? new Host({
        onToolInput: (toolInput) => emit({ toolInput }),
        onToolResult: (toolResult) => emit({ toolResult }),
        onContext: (context) => emit({ context }),
      })
    : null;

  const ready = host
    ? host
        .connect()
        .then(() => emit({ context: host.hostContext }))
        .catch((error) => {
          console.error("JobPaper: host connection failed", error);
        })
    : Promise.resolve();

  return {
    host,
    ready,
    get state() {
      return state;
    },
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type Bridge = ReturnType<typeof createBridge>;
