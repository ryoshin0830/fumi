export function flowState({ mode, step, contentReady, recipientReady, secretReady, signerReady }) {
  const count = mode === 'encrypt' ? 3 : 2;
  const reachable = !contentReady ? 0 : mode === 'encrypt' && !recipientReady ? 1 : count - 1;
  const current = Math.max(0, Math.min(step, reachable));
  return {
    step: current,
    count,
    reachable,
    canNext: current < count - 1 && (current === 0 ? contentReady : recipientReady),
    canRun:
      current === count - 1 &&
      contentReady &&
      (mode === 'encrypt' ? recipientReady && signerReady : secretReady),
  };
}
