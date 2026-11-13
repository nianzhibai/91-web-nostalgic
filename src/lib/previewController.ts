// Shared preview policy: whether previews are enabled, and which single card
// may play one. Cards own their media; claiming the slot stops the previous one.

type Listener = (enabled: boolean) => void;
export type PreviewOwner = { stop: () => void };

// Do not activate previews until the server policy has been loaded.
let enabled = false;
let activeOwner: PreviewOwner | null = null;
const listeners = new Set<Listener>();

export const previewController = {
  isEnabled(): boolean {
    return enabled;
  },

  setEnabled(next: boolean) {
    if (enabled === next) return;
    enabled = next;
    listeners.forEach((fn) => fn(enabled));
  },

  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },

  /** Make `owner` the only playing preview, stopping whichever played before. */
  claim(owner: PreviewOwner) {
    const previous = activeOwner;
    activeOwner = owner;
    if (previous && previous !== owner) previous.stop();
  },

  release(owner: PreviewOwner) {
    if (activeOwner === owner) activeOwner = null;
  },
};
