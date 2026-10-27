import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flowState } from '../src/flow.js';

const ready = {
  mode: 'encrypt',
  step: 2,
  contentReady: true,
  recipientReady: true,
  secretReady: true,
  signerReady: true,
};

test('first-time encryption exposes only content and cannot skip missing prerequisites', () => {
  assert.deepEqual(flowState({ ...ready, step: 0, contentReady: false }), {
    step: 0,
    count: 3,
    reachable: 0,
    canNext: false,
    canRun: false,
  });
  assert.equal(flowState({ ...ready, recipientReady: false }).step, 1);
  assert.equal(flowState({ ...ready, recipientReady: false }).canRun, false);
  assert.equal(flowState({ ...ready, step: 1, recipientReady: false }).canNext, false);
  assert.equal(flowState({ ...ready, step: 0 }).canNext, true);
});

test('encryption runs only at review with the requested signer ready', () => {
  assert.equal(flowState(ready).canRun, true);
  assert.equal(flowState({ ...ready, step: 1 }).canRun, false);
  assert.equal(flowState({ ...ready, signerReady: false }).canRun, false);
  assert.equal(flowState({ ...ready, signerReady: false }).step, 2);
});

test('decryption has two steps and requires its own secret key only for the final action', () => {
  assert.deepEqual(flowState({ ...ready, mode: 'decrypt', step: 0, secretReady: false }), {
    step: 0,
    count: 2,
    reachable: 1,
    canNext: true,
    canRun: false,
  });
  assert.equal(
    flowState({ ...ready, mode: 'decrypt', step: 1, recipientReady: false }).canRun,
    true,
  );
  assert.equal(flowState({ ...ready, mode: 'decrypt', step: 1, secretReady: false }).canRun, false);
});

test('removing content clamps obsolete progress and earlier steps remain editable', () => {
  assert.equal(flowState({ ...ready, contentReady: false }).step, 0);
  assert.equal(flowState({ ...ready, mode: 'decrypt', contentReady: false }).step, 0);
  assert.equal(flowState({ ...ready, step: 0 }).reachable, 2);
  assert.equal(flowState({ ...ready, step: -1 }).step, 0);
  assert.equal(flowState({ ...ready, step: 99 }).step, 2);
});
