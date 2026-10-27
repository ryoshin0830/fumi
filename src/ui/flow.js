import { $ } from './dom.js';

const labels = {
  encrypt: ['内容', '相手', '確認'],
  decrypt: ['受け取ったデータ', 'あなたの鍵'],
};
const headings = {
  encrypt: [
    ['何を渡しますか？', 'まずは、相手に渡したいメッセージやファイルを用意します。'],
    ['誰に渡しますか？', '相手の公開鍵を使って、その人が開けるデータを作ります。'],
    ['確認して、暗号化', '作成したデータは、保存・コピーして相手に渡せます。'],
  ],
  decrypt: [
    ['受け取ったデータを入れる', '暗号文を貼り付けるか、受け取ったファイルを選びます。'],
    ['あなたの鍵で開く', '対応する秘密鍵を使って、元の内容を取り出します。'],
  ],
};

export function renderFlow({ mode, state, busy, result, summaries, hint }) {
  $('main-form').hidden = Boolean(result);
  $('workspace-heading').hidden = Boolean(result);
  $('flow-progress').hidden = Boolean(result);
  $('flow-progress').style.setProperty('--steps', state.count);
  const [title, description] = headings[mode][state.step];
  $('operation-title').textContent = title;
  $('operation-description').textContent = description;
  $('step-caption').textContent = `ステップ ${state.step + 1} / ${state.count}`;
  for (const element of document.querySelectorAll('[data-flow-mode]')) {
    element.hidden =
      element.dataset.flowMode !== mode || Number(element.dataset.flowStep) !== state.step;
  }
  for (const button of document.querySelectorAll('[data-go-step]')) {
    const index = Number(button.dataset.goStep);
    button.parentElement.hidden = index >= state.count;
    button.disabled = busy || index > state.reachable;
    button.classList.toggle('completed', index < state.step);
    if (index === state.step) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    button.querySelector('.flow-label').textContent = labels[mode][index] || '';
    button.querySelector('.flow-summary').textContent = index < state.step ? summaries[index] : '';
  }
  $('back-button').hidden = state.step === 0 || busy;
  $('next-button').hidden = state.step === state.count - 1;
  $('next-button').disabled = busy || !state.canNext;
  $('next-label').textContent =
    mode === 'encrypt' && state.step === 0
      ? '渡す相手を選ぶ'
      : mode === 'encrypt'
        ? '内容を確認する'
        : '自分の鍵を用意する';
  $('run-button').hidden = state.step !== state.count - 1;
  $('run-button').disabled = busy || !state.canRun;
  $('flow-hint').textContent = hint;
  $('flow-hint').hidden = !hint || busy;
  $('result-cancel-button').hidden = !busy || !result;
}
