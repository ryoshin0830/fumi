import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale } from '../src/i18n.js';
import { createCipherMotion } from '../src/ui/motion.js';

function setup(t) {
  const nodes = Object.fromEntries(
    [
      'cipher-illustration',
      'cipher-letters',
      'cipher-caption',
      'cipher-paper',
      'cipher-seal',
      'cipher-orbit',
      'cipher-wave',
    ].map((id) => [id, { dataset: {}, textContent: '', isConnected: true }]),
  );
  const listeners = new Map();
  const frames = new Map();
  const animations = [];
  for (const node of Object.values(nodes))
    node.animate = () => {
      const animation = {
        cancel() {
          this.cancelled = true;
        },
      };
      animations.push(animation);
      return animation;
    };
  nodes['cipher-illustration'].querySelectorAll = () => [];
  const media = {
    matches: false,
    addEventListener(_event, handler) {
      this.change = handler;
    },
  };
  let next = 0;
  for (const [name, value] of Object.entries({
    document: {
      documentElement: {},
      getElementById: (id) => nodes[id],
      addEventListener: (type, callback) => listeners.set(type, callback),
      dispatchEvent: (event) => listeners.get(event.type)?.(event),
    },
    matchMedia: () => media,
    getComputedStyle: () => ({ getPropertyValue: () => 'cubic-bezier(0.23, 1, 0.32, 1)' }),
    requestAnimationFrame: (callback) => {
      frames.set(++next, callback);
      return next;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, value });
    t.after(() =>
      previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name],
    );
  }
  return { motion: createCipherMotion(), nodes, frames, media, animations };
}

test('cipher motion is bounded, reverses for decryption and never gates completion', (t) => {
  const { motion, nodes, frames } = setup(t);
  motion.start('encrypt');
  assert.equal(nodes['cipher-illustration'].dataset.motion, 'working');
  assert.equal(frames.size, 1);
  motion.finish(true);
  assert.equal(nodes['cipher-illustration'].dataset.motion, 'complete');
  assert.equal(frames.size, 1, 'completion returns immediately while the illustration can finish');
  const [id, draw] = frames.entries().next().value;
  frames.delete(id);
  draw(performance.now() + 1000);
  assert.equal(frames.size, 0);
  assert.match(nodes['cipher-letters'].textContent, /^[a-zA-Z0-9]+$/);
  motion.start('decrypt');
  const [decryptId, decryptDraw] = frames.entries().next().value;
  frames.delete(decryptId);
  decryptDraw(performance.now() + 1000);
  assert.equal(nodes['cipher-letters'].textContent, 'メッセージの内容');
});

test('reset and errors cancel scheduled text changes', (t) => {
  const { motion, nodes, frames, animations } = setup(t);
  motion.start('encrypt');
  assert.ok(animations.length > 0, 'the encryption illustration has a visible choreography');
  motion.reset();
  assert.ok(animations.every((animation) => animation.cancelled));
  assert.equal(frames.size, 0);
  assert.equal(nodes['cipher-illustration'].dataset.motion, 'idle');
  assert.equal(nodes['cipher-letters'].textContent, 'メッセージの内容');
  motion.start('encrypt');
  motion.finish(false);
  assert.equal(frames.size, 0);
  assert.equal(nodes['cipher-illustration'].dataset.motion, 'idle');
});

test('reduced motion schedules no frames and stops an animation already running', (t) => {
  const { motion, frames, media } = setup(t);
  media.matches = true;
  motion.start('encrypt');
  assert.equal(frames.size, 0);
  media.matches = false;
  motion.start('decrypt');
  assert.equal(frames.size, 1);
  media.matches = true;
  media.change();
  assert.equal(frames.size, 0);
});

test('changing locale updates illustration copy without restarting active animation', (t) => {
  const { motion, nodes, frames } = setup(t);
  motion.reset();
  setLocale('en', null);
  assert.equal(nodes['cipher-letters'].textContent, 'Message content');
  assert.equal(nodes['cipher-caption'].textContent, 'Processing stays on this device.');
  motion.start('decrypt');
  const scheduled = frames.size;
  setLocale('fr', null);
  assert.equal(frames.size, scheduled);
  assert.equal(nodes['cipher-caption'].textContent, 'Déchiffrement…');
  setLocale('ja', null);
});
