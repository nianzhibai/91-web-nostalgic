import { registerHooks } from "node:module";

// Vite bundles component stylesheet imports. Under Node they are side-effect
// imports with nothing to execute, so load them as empty modules.
registerHooks({
  load(url, context, nextLoad) {
    if (new URL(url).pathname.endsWith(".css")) {
      return { format: "module", source: "", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});
