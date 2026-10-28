import assert from 'node:assert/strict';
import { test } from 'node:test';
import vm from 'node:vm';
import { build } from 'esbuild';

async function client(external) {
  const workers = [];
  const revoked = [];
  class Worker {
    constructor(url) {
      this.url = url;
      workers.push(this);
    }
    postMessage(message) {
      this.message = message;
    }
    terminate() {
      this.terminated = true;
    }
  }
  const { outputFiles } = await build({
    entryPoints: ['src/worker-client.js'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'api',
    define: {
      __WORKER_URL__: external ? '"/assets/crypto-worker-TEST.js"' : 'null',
      __WORKER_CODE__: '"embedded worker"',
    },
  });
  const context = {
    Worker,
    Blob,
    DOMException,
    URL: { createObjectURL: () => 'blob:embedded', revokeObjectURL: (url) => revoked.push(url) },
  };
  vm.runInNewContext(outputFiles[0].text, context);
  return { ...context.api, workers, revoked };
}

for (const external of [false, true]) {
  test(`${external ? 'web' : 'standalone'} worker resolves jobs, cancels pending work, and restarts cleanly`, async () => {
    const api = await client(external);
    const result = api.runCrypto('inspect', { pgp: [] });
    const first = api.workers[0];
    assert.equal(first.url, external ? '/assets/crypto-worker-TEST.js' : 'blob:embedded');
    assert.deepEqual(api.revoked, external ? [] : ['blob:embedded']);
    first.onmessage({ data: { id: first.message.id, result: { ready: true } } });
    assert.equal((await result).ready, true);
    const pending = api.runCrypto('decrypt', {});
    const cancelled = assert.rejects(pending, { name: 'AbortError' });
    api.cancelCrypto();
    await cancelled;
    assert.equal(first.terminated, true);
    const restarted = api.runCrypto('inspect', {});
    const second = api.workers[1];
    second.onmessage({
      data: { id: second.message.id, error: 'password required', code: 'PASSPHRASE_REQUIRED' },
    });
    await assert.rejects(restarted, { code: 'PASSPHRASE_REQUIRED' });
    const failed = api.runCrypto('inspect', {});
    second.onerror({ preventDefault() {} });
    await assert.rejects(failed, /暗号処理/);
    assert.equal(second.terminated, true);
  });
}
