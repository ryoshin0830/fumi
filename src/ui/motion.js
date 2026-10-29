import { setText, t } from '../i18n.js';
import { $ } from './dom.js';

export function createCipherMotion() {
  const illustration = $('cipher-illustration');
  const text = $('cipher-letters');
  const caption = $('cipher-caption');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let phrase = Array.from(t('メッセージの内容'));
  document.addEventListener('fumi:localechange', () => {
    phrase = Array.from(t('メッセージの内容'));
    if (illustration.dataset.motion === 'idle') text.textContent = phrase.join('');
    else if (illustration.dataset.motion === 'complete') finalText();
  });
  const alphabet = 'a7F2k9Q4m8B6x3P5';
  let frame;
  let operation = 'encrypt';
  const animations = [];
  const encoded = () => phrase.map((_, index) => alphabet[index % alphabet.length]).join('');
  function stop() {
    cancelAnimationFrame(frame);
    frame = null;
    for (const animation of animations.splice(0)) animation.cancel();
  }
  function finalText() {
    text.textContent = operation === 'encrypt' ? encoded() : phrase.join('');
  }
  function reset() {
    stop();
    illustration.dataset.motion = 'idle';
    text.textContent = phrase.join('');
    setText(caption, '処理はこの端末内で行います。');
  }
  function choreograph(mode) {
    const easing = getComputedStyle(illustration).getPropertyValue('--ease-out').trim();
    const play = (node, keyframes, duration = 1100, delay = 0) => {
      if (node?.animate)
        animations.push(node.animate(keyframes, { duration, delay, easing, fill: 'none' }));
    };
    const fold = [
      { transform: 'rotate(-7deg) translateY(0) scale(1)', offset: 0 },
      { transform: 'rotate(9deg) translateY(-18px) scale(1.05)', offset: 0.35 },
      { transform: 'rotate(0) rotateX(62deg) translateY(10px) scale(0.92)', offset: 0.7 },
      { transform: 'rotate(0) translateY(-6px) scale(1)', offset: 1 },
    ];
    play(
      $('cipher-paper'),
      mode === 'encrypt'
        ? fold
        : fold
            .slice()
            .reverse()
            .map((keyframe) => ({ ...keyframe, offset: 1 - keyframe.offset })),
    );
    play($('cipher-seal'), [
      { transform: 'rotate(-7deg) scale(0.9)', offset: 0 },
      { transform: 'translate(-18px,-16px) rotate(20deg) scale(1.2)', offset: 0.5 },
      { transform: 'rotate(0) scale(1.05)', offset: 1 },
    ]);
    play($('cipher-orbit'), [
      { transform: 'rotate(-45deg) scale(0.95)', opacity: 0 },
      { transform: 'rotate(70deg) scale(1.1)', opacity: 0.8, offset: 0.45 },
      { transform: 'rotate(170deg) scale(1.2)', opacity: 0 },
    ]);
    play(
      $('cipher-wave'),
      [
        { transform: 'scale(0.95)', opacity: 0 },
        { transform: 'scale(1.2)', opacity: 0.6, offset: 0.3 },
        { transform: 'scale(1.65)', opacity: 0 },
      ],
      1000,
      180,
    );
    illustration.querySelectorAll('.cipher-spark').forEach((spark, index) => {
      const angle = (index * Math.PI) / 6;
      const distance = 72 + (index % 3) * 20;
      play(
        spark,
        [
          { transform: 'translate(0,0) scale(0.95)', opacity: 0 },
          { opacity: 0.85, offset: 0.2 },
          {
            transform: `translate(${Math.cos(angle) * distance}px,${Math.sin(angle) * distance}px) scale(0.5)`,
            opacity: 0,
          },
        ],
        900,
        index * 18,
      );
    });
  }
  function start(mode) {
    stop();
    operation = mode;
    illustration.dataset.operation = mode;
    illustration.dataset.motion = 'working';
    setText(caption, mode === 'encrypt' ? '暗号化しています…' : '復号しています…');
    if (reduced.matches) {
      finalText();
      return;
    }
    choreograph(mode);
    const started = performance.now();
    let lastStep = -1;
    const draw = (now) => {
      const progress = Math.min(1, (now - started) / 950);
      const step = Math.floor(progress * 28);
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
    setText(caption, operation === 'encrypt' ? '暗号化しました。' : '復号しました。');
  }
  reduced.addEventListener('change', () => {
    if (reduced.matches) {
      stop();
      if (illustration.dataset.motion !== 'idle') finalText();
    }
  });
  return { start, finish, reset };
}
