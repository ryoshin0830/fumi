import { $ } from './dom.js';

export function createCipherMotion() {
  const illustration = $('cipher-illustration');
  const text = $('cipher-letters');
  const caption = $('cipher-caption');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const phrase = Array.from('大切なことを、相手だけに。');
  const alphabet = 'a7F2k9Q4m8B6x3P5';
  let frame;
  let operation = 'encrypt';
  const encoded = () => phrase.map((_, index) => alphabet[index % alphabet.length]).join('');
  function stop() {
    cancelAnimationFrame(frame);
    frame = null;
  }
  function finalText() {
    text.textContent = operation === 'encrypt' ? encoded() : phrase.join('');
  }
  function reset() {
    stop();
    illustration.dataset.motion = 'idle';
    text.textContent = phrase.join('');
    caption.textContent = '読むことができるのは、届けたい相手だけ。';
  }
  function start(mode) {
    stop();
    operation = mode;
    illustration.dataset.operation = mode;
    illustration.dataset.motion = 'working';
    caption.textContent =
      mode === 'encrypt'
        ? 'メッセージに、相手だけの鍵を。'
        : 'あなたの鍵で、メッセージを開きます。';
    if (reduced.matches) {
      finalText();
      return;
    }
    const started = performance.now();
    let lastStep = -1;
    const draw = (now) => {
      const progress = Math.min(1, (now - started) / 700);
      const step = Math.floor(progress * 18);
      if (step !== lastStep) {
        const changed = Math.ceil(progress * phrase.length);
        text.textContent = phrase
          .map((letter, index) => {
            const cipher = alphabet[(index + step) % alphabet.length];
            return mode === 'encrypt'
              ? index < changed
                ? cipher
                : letter
              : index < changed
                ? letter
                : cipher;
          })
          .join('');
        lastStep = step;
      }
      if (progress < 1) frame = requestAnimationFrame(draw);
      else {
        frame = null;
        finalText();
      }
    };
    frame = requestAnimationFrame(draw);
  }
  function finish(success) {
    if (!success) {
      reset();
      return;
    }
    illustration.dataset.motion = 'complete';
    caption.textContent =
      operation === 'encrypt'
        ? '相手だけが開ける、ひとつのメッセージに。'
        : 'あなた宛てのメッセージが、届きました。';
  }
  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      stop();
      if (illustration.dataset.motion !== 'idle') finalText();
    }
  });
  return { start, finish, reset };
}
