import { flowState } from './flow.js';
import { renderFlow } from './ui/flow.js';
import { $, size, formatLabel } from './ui/dom.js';
import { renderResultView } from './ui/result.js';
import { renderSignatureView } from './ui/signature.js';
import { resolveGitHub, parseGitHub, clearGitHubKeyCache } from './recipients.js';
import { runCrypto, cancelCrypto } from './worker-client.js';
import { detectFormat, safeFilename, signingKeyType } from './files.js';
import { MAX_BYTES, MAX_ENCRYPTED_BYTES, MAX_KEY_BYTES, byteLength } from './limits.js';

const drafts = {
  encrypt: { kind: 'text', file: null, result: null },
  decrypt: { kind: 'text', file: null, result: null },
  secret: { kind: 'text', file: null },
  signer: { kind: 'text', file: null },
};
let mode = 'encrypt';
const progress = { encrypt: 0, decrypt: 0 };
let recipient = null;
let demoKey = null;
let job = 0;
let busy = false;
let controller;
const valueOf = (kind) =>
  drafts[kind].kind === 'file' ? drafts[kind].file?.bytes : $(kind + '-text').value;
const announce = (text) => {
  $('live-status').textContent = text;
};
function focusHeading(id) {
  $(id).focus({ preventScroll: true });
  document.querySelector('.operation-tabs').scrollIntoView({ block: 'start', behavior: 'instant' });
}
const ownerOf = (kind) => (kind === 'secret' ? 'decrypt' : kind === 'signer' ? 'encrypt' : kind);
const contentKinds = ['encrypt', 'decrypt'];
const filePlaceholder = (kind) =>
  kind === 'encrypt'
    ? 'ファイルをここにドロップ'
    : kind === 'decrypt'
      ? '暗号化ファイルをドロップ'
      : kind === 'signer'
        ? '署名用の秘密鍵ファイルを選ぶ'
        : '秘密鍵ファイルを選ぶ';

function hasDraft(operation) {
  const fields =
    operation === 'encrypt'
      ? [
          'encrypt-text',
          'github-user',
          'recipient-text',
          'signer-github',
          'signer-text',
          'signer-passphrase',
        ]
      : ['decrypt-text', 'secret-text', 'passphrase'];
  const kinds = operation === 'encrypt' ? ['encrypt', 'signer'] : ['decrypt', 'secret'];
  return Boolean(
    drafts[operation].result ||
    fields.some((id) => $(id).value.length) ||
    kinds.some((kind) => drafts[kind].file) ||
    (operation === 'encrypt' && (recipient || $('include-signature').checked)),
  );
}

function clearErrors() {
  for (const element of document.querySelectorAll('.field-error,#operation-error')) {
    element.hidden = true;
    element.textContent = '';
  }
  for (const element of document.querySelectorAll('[aria-invalid]'))
    element.removeAttribute('aria-invalid');
  $('github-recovery').hidden = true;
}
function errorAt(id, message, input) {
  let parent = $(id).parentElement;
  while (parent) {
    if (parent.tagName === 'DETAILS') parent.open = true;
    parent = parent.parentElement;
  }
  $(id).textContent = message;
  $(id).hidden = false;
  if (input) {
    $(input).setAttribute('aria-invalid', 'true');
    $(input).focus();
  }
  announce(message);
}
function updateButton() {
  const content = valueOf(mode);
  const exists =
    drafts[mode].kind === 'file' ? Boolean(drafts[mode].file) : Boolean(content?.trim());
  const keyExists =
    mode === 'encrypt'
      ? Boolean(recipient?.format && recipient[recipient.format]?.length)
      : drafts.secret.kind === 'file'
        ? Boolean(drafts.secret.file)
        : Boolean(valueOf('secret')?.trim());
  const signing = mode === 'encrypt' && $('include-signature').checked;
  const signerReady =
    !signing ||
    Boolean(
      $('signer-github').value.trim() &&
      (drafts.signer.kind === 'file' ? drafts.signer.file : valueOf('signer')?.trim()),
    );
  const state = flowState({
    mode,
    step: progress[mode],
    contentReady: exists && (mode === 'encrypt' || Boolean(detectFormat(content))),
    recipientReady: Boolean(recipient?.format && recipient[recipient.format]?.length),
    secretReady: keyExists,
    signerReady,
  });
  progress[mode] = state.step;
  if (!busy)
    $('run-label').textContent =
      mode === 'encrypt' ? (signing ? '署名を付けて作成' : '鍵をかけて作成') : '元の内容を開く';
  $('run-button').classList.toggle('complete', Boolean(drafts[mode].result));
  updateDeliveryHint();
  const contentSummary =
    drafts[mode].kind === 'file' ? drafts[mode].file?.name || 'ファイル' : 'メッセージ';
  const person = recipient?.sample
    ? 'お試し用の相手'
    : recipient?.username
      ? '@' + recipient.username
      : '指定した公開鍵の持ち主';
  $('review-content').textContent =
    drafts.encrypt.kind === 'file'
      ? `${drafts.encrypt.file?.name || 'ファイル'} · ${size(drafts.encrypt.file?.bytes.length || 0)}`
      : '「' +
        Array.from($('encrypt-text').value.slice(0, 80))
          .slice(0, 32)
          .join('')
          .replace(/\s+/g, ' ') +
        ($('encrypt-text').value.length > 32 ? '…' : '') +
        '」';
  $('review-recipient').textContent = person;
  const bundle =
    signing &&
    (recipient?.format === 'ssh' ||
      (Boolean(valueOf('signer')) && signingKeyType(valueOf('signer')) === 'ssh'));
  $('review-opening').textContent =
    '相手はFumiの「受け取って開く」で、対応する秘密鍵を使って開けます。' +
    (recipient?.format === 'ssh'
      ? ' ほかのツールではageに対応しています。GPGでは開けません。'
      : ' GPGでも開けます。') +
    (bundle ? ' 署名も同封します。GPG・ageを使う相手は、復号したあとZIPを展開します。' : '');
  let hint = '';
  if (state.step === 0 && !state.canNext)
    hint =
      mode === 'decrypt' && exists
        ? '受け取った暗号文の全文か、暗号化されたファイルを指定してください。'
        : drafts[mode].kind === 'file'
          ? 'ファイルをひとつ選ぶと、次に進めます。'
          : 'メッセージを入力すると、次に進めます。';
  else if (mode === 'encrypt' && state.step === 1 && !state.canNext)
    hint = '相手の公開鍵を読み込むと、確認に進めます。';
  else if (state.step === state.count - 1 && !state.canRun)
    hint =
      mode === 'encrypt'
        ? '署名には、あなたのGitHubユーザー名と秘密鍵が必要です。'
        : 'あなたの秘密鍵を指定すると、開けるようになります。';
  const sampleAvailable = state.step === 0 && !hasDraft(mode);
  const sampleResult = mode === 'encrypt' && Boolean(drafts.encrypt.result?.demoKey);
  const sampleBlocked = sampleResult && hasDraft('decrypt');
  $('try-decrypt-button').hidden = !sampleResult || sampleBlocked;
  $('sample-decrypt-hint').hidden = !sampleBlocked;
  renderFlow({
    mode,
    state,
    busy,
    result: drafts[mode].result,
    summaries: [contentSummary, person, ''],
    hint,
    sampleAvailable,
  });
}
function setBusy(value, label = '処理しています…') {
  busy = value;
  for (const element of document.querySelectorAll(
    '#main-form button,#main-form input,#main-form textarea,#demo-button',
  ))
    element.disabled = value;
  $('cancel-button').disabled = false;
  $('cancel-button').hidden = !value;
  $('workspace').setAttribute('aria-busy', String(value));
  $('run-button').classList.toggle('working', value);
  $('lookup-button').textContent =
    value && label.includes('GitHub') ? '探しています…' : '相手の鍵を探す';
  if (value) $('run-label').textContent = label;
  updateSignerFields();
  updateButton();
}
function cancelWork() {
  job++;
  controller?.abort();
  controller = null;
  cancelCrypto();
  const verification = drafts[mode].result?.verification;
  if (verification?.state === 'pending') {
    verification.state = 'unavailable';
    verification.message =
      'GitHubとの照合を中止しました。署名と内容の整合性は端末内で確認済みです。';
    renderSignature();
  }
  setBusy(false);
}
function invalidate(which = mode) {
  drafts[which].result = null;
  if (which === mode) renderResult();
  clearErrors();
  updateButton();
}
function selectKind(kind, type) {
  drafts[kind].kind = type;
  $(kind + '-text-pane').hidden = type !== 'text';
  $(kind + '-file-pane').hidden = type !== 'file';
  document
    .querySelectorAll(`[data-input="${kind}"]`)
    .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.kind === type)));
  if (contentKinds.includes(kind)) updateContent(kind);
  updateButton();
}
function updateContent(kind) {
  const value = valueOf(kind);
  $(kind + '-size').textContent = byteLength(value) ? size(byteLength(value)) : '';
  if (kind === 'decrypt') {
    const format = detectFormat(value);
    $('decrypt-content-hint').textContent = format
      ? '開ける形式のデータです。次に、自分の鍵を用意します。'
      : '受け取った暗号文やファイルを、そのまま指定してください。';
    $('secret-hint').textContent =
      format === 'ssh'
        ? '対応するSSH秘密鍵（Ed25519 / RSA）を使います。'
        : format === 'pgp'
          ? '対応するOpenPGP秘密鍵を使います。'
          : 'あなたの端末に保管している秘密鍵です。GitHubからは取得できません。';
  }
}
function switchMode(next, focus = false) {
  if (next === mode) return;
  if (busy) {
    cancelWork();
    announce('処理を中止して切り替えました。');
  }
  mode = next;
  for (const operation of ['encrypt', 'decrypt']) {
    $(operation + '-panel').hidden = mode !== operation;
    $(operation + '-tab').setAttribute('aria-selected', String(mode === operation));
    $(operation + '-tab').tabIndex = mode === operation ? 0 : -1;
  }
  clearErrors();
  renderResult();
  updateButton();
  if (focus) $(mode + '-tab').focus();
}
function renderRecipient() {
  const ready = Boolean(recipient?.format);
  $('recipient-card').hidden = !ready;
  $('recipient-placeholder').hidden = ready;
  if (!ready) {
    $('key-list').replaceChildren();
    return;
  }
  const selected = recipient[recipient.format];
  $('recipient-name').textContent = recipient.sample
    ? 'サンプル用の公開鍵'
    : recipient.username
      ? `@${recipient.username}`
      : '直接指定した公開鍵';
  $('recipient-avatar').textContent = recipient.username
    ? recipient.username.slice(0, 2).toUpperCase()
    : '鍵';
  $('recipient-count').textContent =
    `使用する公開鍵 ${selected.length}件${recipient.cached ? ' · 1分以内の取得結果' : ''}`;
  $('format-badge').textContent = recipient.format === 'pgp' ? 'OpenPGP' : 'SSH / age';
  $('format-explanation').textContent =
    recipient.format === 'pgp'
      ? 'GPG互換のOpenPGP形式で暗号化します。'
      : 'SSH公開鍵を使い、age形式で暗号化します。GPGとは別の形式です。';
  if (recipient.excluded)
    $('format-explanation').textContent +=
      ` 非対応・暗号化不可の鍵 ${recipient.excluded}件を除外しました。`;
  $('format-switch').hidden = !recipient.pgp.length || !recipient.ssh.length;
  document
    .querySelectorAll('[data-format]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.format === recipient.format)),
    );
  $('key-list').replaceChildren(
    ...selected.map((item) => {
      const li = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = item.label;
      const fingerprint = document.createElement('code');
      fingerprint.textContent = item.fingerprint;
      li.append(label, fingerprint);
      return li;
    }),
  );
  $('source-link').hidden = !recipient.username;
  if (recipient.username)
    $('source-link').href =
      `https://github.com/${recipient.username}.${recipient.format === 'pgp' ? 'gpg' : 'keys'}`;
  updateButton();
}
function renderResult() {
  renderResultView(drafts[mode].result, mode);
  renderSignature();
  updateButton();
}
async function withJob(label, action, errorId = 'operation-error') {
  if (busy) return;
  clearErrors();
  const id = ++job;
  setBusy(true, label);
  announce(label);
  try {
    await action(() => id === job);
  } catch (error) {
    if (id === job && error.name !== 'AbortError') {
      const target =
        errorId === 'operation-error' && mode === 'encrypt' && $('include-signature').checked
          ? 'signer-error'
          : errorId === 'operation-error' && mode === 'decrypt'
            ? /秘密鍵|パスフレーズ/.test(error.message)
              ? 'secret-error'
              : /暗号文|形式/.test(error.message)
                ? 'decrypt-content-error'
                : errorId
            : errorId;
      if (target === 'decrypt-content-error') {
        progress.decrypt = 0;
        updateButton();
      }
      errorAt(target, error.message);
      $(target).tabIndex = -1;
      $(target).focus();
    }
  } finally {
    if (id === job) setBusy(false);
  }
}

$('main-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (busy || $('run-button').disabled) return;
  const activeMode = mode;
  invalidate();
  withJob(mode === 'encrypt' ? '暗号化しています…' : '復号しています…', async (current) => {
    const value = valueOf(activeMode);
    const data =
      typeof value === 'string' && activeMode === 'encrypt'
        ? new TextEncoder().encode(value)
        : value;
    let result;
    if (activeMode === 'encrypt') {
      let signer;
      if ($('include-signature').checked) {
        const privateKey = valueOf('signer');
        const type = signingKeyType(privateKey);
        const account = parseGitHub($('signer-github').value);
        if (account.preferred && account.preferred !== type)
          throw new Error('GitHub URLの鍵の形式と、署名用の秘密鍵の形式が異なります。');
        controller = new AbortController();
        $('run-label').textContent = '署名鍵をGitHubと照合中…';
        const source = await resolveGitHub(account.username, {
          signal: controller.signal,
          keyType: type,
          fresh: true,
        });
        if (!current()) return;
        if (source.errors.length)
          throw new Error(
            '署名用のGitHub公開鍵を照合できません。' +
              source.errors.join(' ') +
              ' 署名を付ける設定をオフにすると、暗号化だけを続けられます。',
          );
        signer = {
          github: source.username,
          privateKey,
          passphrase: $('signer-passphrase').value,
          registeredKeys: source[type],
        };
        $('run-label').textContent = '署名して暗号化中…';
      }
      result = await runCrypto('encrypt', {
        data,
        recipients: recipient[recipient.format].map((item) => item.key),
        format: recipient.format,
        filename:
          drafts.encrypt.kind === 'file' ? safeFilename(drafts.encrypt.file.name) : 'message.txt',
        armored: drafts.encrypt.kind === 'text',
        signer,
      });
    } else
      result = await runCrypto('decrypt', {
        data,
        privateKey: valueOf('secret'),
        passphrase: $('passphrase').value,
        sourceName: drafts.decrypt.kind === 'file' ? drafts.decrypt.file.name : '',
      });
    if (!current()) return;
    if (activeMode === 'encrypt' && demoKey) result.demoKey = demoKey;
    if (activeMode === 'encrypt' && result.verification)
      result.verification.checkedAt = new Date().toISOString();
    drafts[activeMode].result = result;
    renderResult();
    if (activeMode === 'decrypt' && result.verification)
      await checkGitHubSignature(result, current);
    if (!current()) return;
    announce(
      activeMode === 'encrypt'
        ? '暗号化できました。結果を保存・コピーできます。'
        : result.verification
          ? `復号できました。@${result.verification.github} の署名：${$('signature-status-title').textContent}`
          : '復号できました。結果を保存できます。',
    );
    $('result-title').tabIndex = -1;
    focusHeading('result-title');
  });
});
$('lookup-button').addEventListener('click', () => {
  if (busy) return;
  try {
    parseGitHub($('github-user').value);
  } catch (error) {
    errorAt('github-error', error.message, 'github-user');
    return;
  }
  recipient = null;
  demoKey = null;
  invalidate('encrypt');
  renderRecipient();
  withJob(
    'GitHubから公開鍵を取得中…',
    async (current) => {
      controller = new AbortController();
      const source = await resolveGitHub($('github-user').value, { signal: controller.signal });
      const keys = await runCrypto('inspect', { pgp: source.pgp, ssh: source.ssh });
      if (!current()) return;
      recipient = {
        ...keys,
        username: source.username,
        cached: source.cached,
        format: source.preferred || (keys.pgp.length ? 'pgp' : keys.ssh.length ? 'ssh' : null),
      };
      if (recipient.format && !keys[recipient.format].length) recipient.format = null;
      // A failed endpoint must not silently change the requested cryptographic format.
      if (source.errors.length && !source.preferred) recipient.format = null;
      renderRecipient();
      if (source.errors.length) {
        errorAt('github-error', source.errors.join(' '));
        $('github-gpg-page').href = `https://github.com/${source.username}.gpg`;
        $('github-ssh-page').href = `https://github.com/${source.username}.keys`;
        $('github-gpg-page').hidden = source.preferred === 'ssh';
        $('github-ssh-page').hidden = source.preferred === 'pgp';
        $('github-recovery').hidden = false;
      } else if (!recipient.format)
        errorAt(
          'github-error',
          source.preferred
            ? '指定した形式で暗号化に使える公開鍵がありません。別の形式のURLか、公開鍵の直接入力をお試しください。'
            : '暗号化に使える鍵がありません。Ed25519・RSAのSSH鍵、または暗号化対応のOpenPGP公開鍵を指定してください。',
        );
      else {
        $('manual-keys').open = false;
        announce(
          `${source.username} の公開鍵を取得しました。${formatLabel(recipient.format)}で暗号化します。`,
        );
      }
    },
    'github-error',
  );
});
$('github-user').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    $('lookup-button').click();
  }
});
$('open-manual-keys').addEventListener('click', () => {
  clearErrors();
  $('manual-keys').open = true;
  $('recipient-text').focus();
});
$('github-user').addEventListener('input', () => {
  recipient = null;
  demoKey = null;
  invalidate('encrypt');
  renderRecipient();
});
$('github-user').addEventListener('blur', () => {
  if ($('github-user').value.trim()) {
    try {
      parseGitHub($('github-user').value);
    } catch (error) {
      errorAt('github-error', error.message);
    }
  }
});

async function useManual(value) {
  recipient = null;
  demoKey = null;
  invalidate('encrypt');
  renderRecipient();
  await withJob(
    '公開鍵を確認しています…',
    async (current) => {
      if (byteLength(value) > MAX_KEY_BYTES) throw new Error('公開鍵は1 MB以下にしてください。');
      const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
      if (text.includes('PRIVATE KEY'))
        throw new Error('暗号化には公開鍵を使います。秘密鍵は入力しないでください。');
      const isPGP = text.includes('BEGIN PGP') || (value instanceof Uint8Array && value[0] >= 128);
      const keys = await runCrypto(
        'inspect',
        isPGP
          ? { pgp: [value] }
          : {
              ssh: text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#')),
            },
      );
      if (!keys.pgp.length && !keys.ssh.length)
        throw new Error(
          keys.messages[0] ||
            '暗号化に使える公開鍵がありません。形式や有効期限を確認してください。',
        );
      if (!current()) return;
      recipient = { ...keys, format: keys.pgp.length ? 'pgp' : 'ssh' };
      renderRecipient();
      $('manual-keys').open = false;
      announce(`${formatLabel(recipient.format)}の公開鍵を読み込みました。`);
    },
    'recipient-error',
  );
}
$('use-key-button').addEventListener('click', () => useManual($('recipient-text').value));
$('recipient-text').addEventListener('input', () => {
  recipient = null;
  demoKey = null;
  invalidate('encrypt');
  renderRecipient();
});
$('recipient-file').addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file || busy) return;
  if (file.size > MAX_KEY_BYTES) {
    errorAt('recipient-error', '公開鍵は1 MB以下にしてください。');
    event.target.value = '';
    return;
  }
  const id = ++job;
  setBusy(true, '公開鍵を読み込み中…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (id !== job) return;
    setBusy(false);
    await useManual(bytes);
  } catch {
    if (id === job) errorAt('recipient-error', '公開鍵ファイルを読み込めませんでした。');
  } finally {
    event.target.value = '';
    if (id === job) setBusy(false);
  }
});
for (const button of document.querySelectorAll('[data-format]'))
  button.addEventListener('click', () => {
    if (recipient?.[button.dataset.format]?.length) {
      recipient.format = button.dataset.format;
      invalidate('encrypt');
      renderRecipient();
    }
  });
for (const button of document.querySelectorAll('[data-operation]'))
  button.addEventListener('click', () => switchMode(button.dataset.operation));
for (const button of document.querySelectorAll('[role="tab"]'))
  button.addEventListener('keydown', (event) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      switchMode(
        event.key === 'Home'
          ? 'encrypt'
          : event.key === 'End'
            ? 'decrypt'
            : mode === 'encrypt'
              ? 'decrypt'
              : 'encrypt',
        true,
      );
    }
  });
for (const button of document.querySelectorAll('[data-input]'))
  button.addEventListener('click', () => {
    if (button.dataset.input === 'encrypt' && recipient?.sample) {
      recipient = null;
      demoKey = null;
      renderRecipient();
    }
    invalidate(ownerOf(button.dataset.input));
    selectKind(button.dataset.input, button.dataset.kind);
  });
for (const kind of ['encrypt', 'decrypt', 'secret', 'signer']) {
  $(kind + '-text').addEventListener('input', () => {
    if (kind === 'encrypt') {
      demoKey = null;
      if (recipient?.sample) {
        recipient = null;
        renderRecipient();
      }
    }
    invalidate(ownerOf(kind));
    if (contentKinds.includes(kind)) updateContent(kind);
  });
  $(kind + '-file').addEventListener('change', (event) => loadFile(kind, event.target.files[0]));
  const drop = document.querySelector(`[data-drop="${kind}"]`);
  drop.addEventListener('dragover', (event) => {
    if (event.dataTransfer.types.includes('Files')) {
      event.preventDefault();
      if (!busy) drop.classList.add('drag-over');
    }
  });
  drop.addEventListener('dragleave', (event) => {
    if (!drop.contains(event.relatedTarget)) drop.classList.remove('drag-over');
  });
  drop.addEventListener('drop', (event) => {
    event.preventDefault();
    drop.classList.remove('drag-over');
    if (!busy) {
      if (event.dataTransfer.files.length !== 1)
        errorAt(
          kind === 'secret'
            ? 'secret-error'
            : kind === 'signer'
              ? 'signer-error'
              : kind + '-content-error',
          'ファイルは1つずつ選択してください。',
        );
      else loadFile(kind, event.dataTransfer.files[0]);
    }
  });
}
async function loadFile(kind, file) {
  if (!file || busy) return;
  const limit =
    kind === 'encrypt'
      ? MAX_BYTES
      : ['secret', 'signer'].includes(kind)
        ? MAX_KEY_BYTES
        : MAX_ENCRYPTED_BYTES;
  drafts[kind].file = null;
  $(kind + '-file-name').textContent = filePlaceholder(kind);
  if ($(kind + '-file-remove')) $(kind + '-file-remove').hidden = true;
  invalidate(ownerOf(kind));
  if (file.size > limit) {
    errorAt(
      kind === 'secret'
        ? 'secret-error'
        : kind === 'signer'
          ? 'signer-error'
          : kind + '-content-error',
      `ファイルは${limit / 1024 ** 2} MB以下にしてください。`,
    );
    $(kind + '-file').value = '';
    return;
  }
  await withJob(
    'ファイルを読み込み中…',
    async (current) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current()) return;
      drafts[kind].file = { bytes, name: file.name };
      if (kind === 'encrypt') {
        demoKey = null;
        if (recipient?.sample) {
          recipient = null;
          renderRecipient();
        }
      }
      $(kind + '-file-name').textContent = file.name;
      if ($(kind + '-file-remove')) $(kind + '-file-remove').hidden = false;
      selectKind(kind, 'file');
      announce(`${file.name} を読み込みました。`);
    },
    kind === 'secret'
      ? 'secret-error'
      : kind === 'signer'
        ? 'signer-error'
        : kind + '-content-error',
  );
  $(kind + '-file').value = '';
}
for (const kind of ['encrypt', 'decrypt'])
  $(kind + '-file-remove').addEventListener('click', () => {
    drafts[kind].file = null;
    $(kind + '-file-name').textContent =
      kind === 'encrypt' ? 'ファイルをここにドロップ' : '暗号化ファイルをドロップ';
    $(kind + '-file-remove').hidden = true;
    invalidate(kind);
    updateContent(kind);
  });
$('passphrase').addEventListener('input', () => invalidate('decrypt'));
$('toggle-passphrase').addEventListener('click', () => {
  const visible = $('passphrase').type === 'password';
  $('passphrase').type = visible ? 'text' : 'password';
  $('toggle-passphrase').setAttribute('aria-pressed', String(visible));
  $('toggle-passphrase').setAttribute(
    'aria-label',
    visible ? 'パスフレーズを隠す' : 'パスフレーズを表示',
  );
});
$('cancel-button').addEventListener('click', () => {
  cancelWork();
  announce('処理を中止しました。入力内容は残っています。');
});
$('demo-button').addEventListener('click', () => {
  if (busy || $('sample-invitation').hidden) return;
  withJob('サンプルを準備中…', async (current) => {
    const sample = await runCrypto('demo', {});
    if (!current()) return;
    invalidate();
    if (mode === 'encrypt') {
      $('encrypt-text').value = sample.text;
      selectKind('encrypt', 'text');
      recipient = { pgp: sample.recipients, ssh: [], format: 'pgp', sample: true };
      demoKey = sample.privateKey;
      renderRecipient();
      updateContent('encrypt');
    } else {
      $('decrypt-text').value = sample.ciphertext;
      $('secret-text').value = sample.privateKey;
      $('passphrase').value = '';
      selectKind('decrypt', 'text');
      selectKind('secret', 'text');
      updateContent('decrypt');
    }
    progress[mode] = mode === 'encrypt' ? 2 : 1;
    updateButton();
    focusHeading('operation-title');
    announce(
      mode === 'encrypt'
        ? 'サンプルを用意しました。鍵をかけて作成できます。'
        : 'サンプルを用意しました。元の内容を開けます。',
    );
  });
});
$('try-decrypt-button').addEventListener('click', () => {
  const result = drafts.encrypt.result;
  if (busy || !result?.demoKey || hasDraft('decrypt')) return;
  switchMode('decrypt');
  $('decrypt-text').value = result.text;
  $('secret-text').value = result.demoKey;
  $('passphrase').value = '';
  selectKind('decrypt', 'text');
  selectKind('secret', 'text');
  invalidate('decrypt');
  progress.decrypt = 1;
  updateContent('decrypt');
  updateButton();
  focusHeading('operation-title');
  announce('サンプルを開く準備ができました。「元の内容を開く」で試せます。');
});
$('copy-button').addEventListener('click', async () => {
  const result = drafts[mode].result;
  if (!result || result.text === null) return;
  try {
    await navigator.clipboard.writeText(result.text);
    if (drafts[mode].result !== result) return;
    $('copy-label').textContent = 'コピーしました';
    announce('クリップボードにコピーしました。');
  } catch {
    if (drafts[mode].result !== result) return;
    $('copy-label').textContent = '選択してコピー';
    $('result-preview-disclosure').open = true;
    $('result-text').focus();
    const selection = getSelection();
    const range = document.createRange();
    range.selectNodeContents($('result-text'));
    selection.removeAllRanges();
    selection.addRange(range);
    announce('コピーが許可されていません。選択したテキストをコピーするか、保存してください。');
  }
});
$('save-button').addEventListener('click', () => {
  const result = drafts[mode].result;
  if (!result) return;
  const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/octet-stream' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = result.filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
function reset(which) {
  progress[which] = 0;
  const kinds = which === 'encrypt' ? ['encrypt', 'signer'] : ['decrypt', 'secret'];
  for (const kind of kinds) {
    $(kind + '-text').value = '';
    $(kind + '-file').value = '';
    drafts[kind].file = null;
    $(kind + '-file-name').textContent = filePlaceholder(kind);
    if ($(kind + '-file-remove')) $(kind + '-file-remove').hidden = true;
    selectKind(kind, 'text');
  }
  drafts[which].result = null;
  if (which === 'encrypt') {
    recipient = null;
    demoKey = null;
    $('include-signature').checked = false;
    $('signer-github').value = '';
    $('signer-passphrase').value = '';
    $('signer-passphrase').type = 'password';
    $('signer-toggle-passphrase').setAttribute('aria-pressed', 'false');
    $('signer-toggle-passphrase').setAttribute('aria-label', '署名鍵のパスフレーズを表示');
    updateSignerFields();
    $('github-user').value = '';
    $('recipient-text').value = '';
    $('recipient-file').value = '';
    $('manual-keys').open = false;
    $('key-details').open = false;
    $('additional-options').open = false;
    renderRecipient();
  } else {
    $('passphrase').value = '';
    $('passphrase').type = 'password';
    $('toggle-passphrase').setAttribute('aria-pressed', 'false');
    $('toggle-passphrase').setAttribute('aria-label', 'パスフレーズを表示');
  }
}
$('clear-button').addEventListener('click', () => {
  cancelWork();
  reset(mode);
  clearErrors();
  renderResult();
  updateButton();
  announce('この画面の入力と結果をクリアしました。');
});
$('clear-all-button').addEventListener('click', () => {
  cancelWork();
  clearGitHubKeyCache();
  reset('encrypt');
  reset('decrypt');
  clearErrors();
  renderResult();
  updateButton();
  announce('両方の画面の入力・鍵・結果をすべて消去しました。');
});
for (const type of ['help', 'about']) {
  $(type + '-button').addEventListener('click', () => $(type + '-dialog').showModal());
  $(type + '-dialog')
    .querySelector('.close-dialog')
    .addEventListener('click', () => $(type + '-dialog').close());
}
$('main-form').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !busy) {
    event.preventDefault();
    if (!$('next-button').hidden) $('next-button').click();
    else $('main-form').requestSubmit();
  }
});
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', (event) => event.preventDefault());
updateButton();

function updateSignerFields() {
  const enabled = $('include-signature').checked;
  $('signer-fields').hidden = !enabled;
  for (const control of $('signer-fields').querySelectorAll('input,textarea,button'))
    control.disabled = busy || !enabled;
}

function updateDeliveryHint() {
  const value = valueOf('signer');
  const hasKey =
    drafts.signer.kind === 'file' ? Boolean(drafts.signer.file) : Boolean(value?.trim());
  const native = recipient?.format === 'pgp' && hasKey && signingKeyType(value) === 'pgp';
  $('signing-delivery-title').textContent = native
    ? 'GPGでそのまま開けます'
    : recipient?.format && hasKey
      ? '相手は復号後にZIPを展開します'
      : '受け取る人の開き方';
  $('signing-delivery-text').textContent = native
    ? '元の本文・ファイルを直接取り出せる、標準の署名付きOpenPGP形式です。'
    : recipient?.format && hasKey
      ? '元の名前のファイル、署名、確認手順をZIPにまとめます。このアプリでは自動で取り出せます。'
      : 'OpenPGP鍵同士はGPG標準形式。ageやSSH署名を使う場合は、元ファイルと署名をZIPに同封します。';
}

function renderSignature() {
  renderSignatureView(drafts[mode].result, mode);
}

async function checkGitHubSignature(result, current) {
  const verification = result.verification;
  verification.state = 'pending';
  delete verification.message;
  renderSignature();
  $('run-label').textContent = '署名をGitHubと照合中…';
  announce(`@${verification.github} の署名をGitHubの公開鍵と照合しています。`);
  controller = new AbortController();
  try {
    const source = await resolveGitHub(verification.github, {
      signal: controller.signal,
      keyType: verification.type,
      fresh: true,
    });
    if (!current() || drafts.decrypt.result !== result) return;
    if (source.errors.length) throw new Error(source.errors.join(' '));
    const checked = await runCrypto('verify-github', {
      verification,
      registeredKeys: source[verification.type],
    });
    if (!current() || drafts.decrypt.result !== result) return;
    verification.state = checked.matched ? 'verified' : 'mismatch';
    verification.checkedAt = new Date().toISOString();
  } catch (error) {
    if (!current() || drafts.decrypt.result !== result) return;
    verification.state = 'unavailable';
    verification.message =
      '署名と内容の整合性は確認済みです。GitHubとの照合は完了していません。 ' +
      (error.name === 'AbortError' ? '照合を中止しました。' : error.message);
  }
  renderSignature();
  announce(`@${verification.github} の署名：${$('signature-status-title').textContent}`);
}

$('include-signature').addEventListener('change', () => {
  updateSignerFields();
  invalidate('encrypt');
  announce(
    $('include-signature').checked
      ? '署名を付けます。GitHubユーザー名と、あなたの秘密鍵を入力してください。'
      : '署名を付けずに暗号化します。',
  );
});
for (const id of ['signer-github', 'signer-passphrase'])
  $(id).addEventListener('input', () => invalidate('encrypt'));
$('signer-github').addEventListener('blur', () => {
  if ($('signer-github').value.trim()) {
    try {
      parseGitHub($('signer-github').value);
    } catch (error) {
      errorAt('signer-error', error.message);
    }
  }
});
$('signer-toggle-passphrase').addEventListener('click', () => {
  const visible = $('signer-passphrase').type === 'password';
  $('signer-passphrase').type = visible ? 'text' : 'password';
  $('signer-toggle-passphrase').setAttribute('aria-pressed', String(visible));
  $('signer-toggle-passphrase').setAttribute(
    'aria-label',
    visible ? '署名鍵のパスフレーズを隠す' : '署名鍵のパスフレーズを表示',
  );
});
$('retry-verification').addEventListener('click', () => {
  const result = drafts.decrypt.result;
  if (!result?.verification || busy || mode !== 'decrypt') return;
  withJob('GitHubと再照合しています…', (current) => checkGitHubSignature(result, current));
});
updateSignerFields();
updateButton();

function changeStep(step) {
  if (busy) return;
  progress[mode] = step;
  clearErrors();
  updateButton();
  focusHeading('operation-title');
  announce($('step-caption').textContent + '、' + $('operation-title').textContent);
}
$('next-button').addEventListener('click', () => {
  if (!$('next-button').disabled) changeStep(progress[mode] + 1);
});
$('back-button').addEventListener('click', () => changeStep(progress[mode] - 1));
for (const button of document.querySelectorAll('[data-go-step]'))
  button.addEventListener('click', () => changeStep(Number(button.dataset.goStep)));
for (const button of document.querySelectorAll('[data-edit-step]'))
  button.addEventListener('click', () => changeStep(Number(button.dataset.editStep)));
$('edit-result-button').addEventListener('click', () => {
  cancelWork();
  invalidate();
  changeStep(progress[mode]);
});
$('result-cancel-button').addEventListener('click', () => {
  cancelWork();
  announce('GitHubとの照合を中止しました。');
});
