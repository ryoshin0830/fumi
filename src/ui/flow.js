import { $ } from './dom.js';

const labels = {
  encrypt: ['内容を用意', '相手を選ぶ', '確認・作成'],
  decrypt: ['受け取ったもの', '自分の鍵で開く'],
};
const headings = {
  encrypt: [
    ['何を届けますか？', '文章を書くか、ファイルを選びます。'],
    ['誰に届けますか？', '受け取る相手に合わせて、鍵をかける準備をします。'],
    ['内容を確認しましょう', '作成したあと、保存・コピーして相手に渡せます。'],
  ],
  decrypt: [
    ['受け取ったものを用意しましょう', '届いた文章を貼り付けるか、ファイルを選びます。'],
    ['自分の鍵で、開きましょう', 'このデータに対応する秘密鍵で、元の内容を取り出します。'],
  ],
};

export function renderFlow({ mode, state, busy, result, summaries, hint, sampleAvailable }) {
  $('main-form').hidden = Boolean(result);
  $('workspace-heading').hidden = Boolean(result);
  $('flow-progress').hidden = Boolean(result);
  $('sample-invitation').hidden = busy || Boolean(result) || !sampleAvailable;
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
      ? '次へ：相手を選ぶ'
      : mode === 'encrypt'
        ? '内容を確認する'
        : '自分の鍵を用意する';
  $('run-button').hidden = state.step !== state.count - 1;
  $('run-button').disabled = busy || !state.canRun;
  $('flow-hint').textContent = hint;
  $('flow-hint').hidden = !hint || busy;
  $('result-cancel-button').hidden = !busy || !result;
}
