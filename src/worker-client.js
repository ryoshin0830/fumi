let worker;
let nextId = 0;
const pending = new Map();
export function cancelCrypto() {
  worker?.terminate();
  worker = null;
  for (const { reject } of pending.values())
    reject(new DOMException('中止しました。', 'AbortError'));
  pending.clear();
}
export function runCrypto(action, payload) {
  if (!worker) {
    const url =
      __WORKER_URL__ ||
      URL.createObjectURL(new Blob([__WORKER_CODE__], { type: 'text/javascript' }));
    worker = new Worker(url);
    if (!__WORKER_URL__) URL.revokeObjectURL(url);
    worker.onmessage = ({ data }) => {
      const task = pending.get(data.id);
      if (!task) return;
      pending.delete(data.id);
      data.error ? task.reject(new Error(data.error)) : task.resolve(data.result);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      for (const task of pending.values())
        task.reject(
          new Error('暗号処理を開始できませんでした。最新のブラウザでHTMLを開き直してください。'),
        );
      pending.clear();
      worker?.terminate();
      worker = null;
    };
  }
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, action, payload });
  });
}
