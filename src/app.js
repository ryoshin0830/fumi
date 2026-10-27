import { $ } from './ui/dom.js';
import { renderResultView } from './ui/result.js';
import { renderSignatureView } from './ui/signature.js';
import { createRecipientPreview } from './ui/recipient.js';
import { createCipherMotion } from './ui/motion.js';
import { resolveGitHub, clearGitHubKeyCache } from './recipients.js';
import { runCrypto, cancelCrypto } from './worker-client.js';
import { MAX_BYTES, MAX_ENCRYPTED_BYTES, MAX_KEY_BYTES, byteLength } from './limits.js';

const drafts = Object.fromEntries(
  ['encrypt', 'decrypt', 'secret', 'recipient'].map((kind) => [
    kind,
    { kind: 'text', file: null, result: null },
  ]),
);
let mode = 'encrypt';
let job = 0;
let busy = false;
let controller;
let manualOpen = false;
let passwordNeeded = false;
let decryptChecked = false;
let decryptTimer;
const recipientPreview = createRecipientPreview({ onKeyFallback: showManualKey });
const cipherMotion = createCipherMotion();
const valueOf = (kind) =>
  drafts[kind].kind === 'file' ? drafts[kind].file?.bytes : $(kind + '-text').value;
const hasValue = (kind) =>
  drafts[kind].kind === 'file'
    ? Boolean(drafts[kind].file)
    : Boolean($(kind + '-text').value.trim());
const ownerOf = (kind) => (kind === 'secret' ? 'decrypt' : kind === 'recipient' ? 'encrypt' : kind);
const announce = (text) => {
  $('live-status').textContent = text;
};
function clearErrors() {
  for (const node of document.querySelectorAll('.field-error')) {
    node.hidden = true;
    node.textContent = '';
  }
  for (const node of document.querySelectorAll('[aria-invalid]'))
    node.removeAttribute('aria-invalid');
}
function errorAt(id, message, input, focus = true) {
  const node = $(id);
  node.textContent = message;
  node.hidden = false;
  node.tabIndex = -1;
  const field = input && !$(input).disabled && $(input).checkVisibility() ? $(input) : node;
  if (input) $(input).setAttribute('aria-invalid', 'true');
  if (focus) field.focus();
  announce(message);
}
function updateForm() {
  document.documentElement.dataset.operation = mode;
  for (const operation of ['encrypt', 'decrypt']) {
    $(operation + '-panel').hidden = operation !== mode;
    $(operation + '-tab').setAttribute('aria-selected', String(operation === mode));
    $(operation + '-tab').tabIndex = operation === mode ? 0 : -1;
  }
  for (const kind of Object.keys(drafts)) {
    const file = drafts[kind].kind === 'file' && drafts[kind].file;
    $(kind + '-text-pane').hidden = Boolean(file);
    $(kind + '-file-pane').hidden = !file;
    $(kind + '-file-name').textContent = file ? file.name : '';
  }
  const manual = manualOpen && hasValue('recipient');
  $('github-recipient').hidden = manual;
  $('recipient-key-box').hidden = !manualOpen;
  $('manual-key-button').hidden = manualOpen;
  $('github-key-button').textContent =
    manual || !$('github-user').value.trim()
      ? 'GitHubユーザー名で指定する'
      : '別のGitHubユーザー名を入力';
  $('recipient-status').hidden = manualOpen;
  $('password-box').hidden = !passwordNeeded;
  $('decrypt-status').hidden = decryptChecked && !passwordNeeded && !busy;
  $('decrypt-status').textContent =
    busy && mode === 'decrypt'
      ? '復号できるか確認しています…'
      : passwordNeeded
        ? 'この秘密鍵にはパスワードが設定されています。入力して復号してください。'
        : decryptChecked
          ? '入力を確認して、もう一度試してください。'
          : '暗号文と秘密鍵を入力すると、自動で復号を試します。';
  recipientPreview.update(
    $('github-user').value,
    mode === 'encrypt' && !manual && !drafts.encrypt.result,
  );
  $('run-button').disabled =
    busy ||
    !hasValue(mode) ||
    (mode === 'encrypt'
      ? !(manual || (!manualOpen && $('github-user').value.trim()))
      : !hasValue('secret') || (passwordNeeded && !$('passphrase').value));
  $('run-button').hidden = mode === 'decrypt' && !passwordNeeded && !decryptChecked;
  if (!busy)
    $('run-label').textContent =
      mode === 'encrypt' ? '暗号化' : passwordNeeded ? '復号' : 'もう一度確認';
  $('cancel-button').hidden = !busy;
  $('main-form').hidden = Boolean(drafts[mode].result);
  $('workspace').setAttribute('aria-busy', String(busy));
  $('result-cancel-button').hidden =
    !busy || drafts[mode].result?.verification?.state !== 'pending';
}
function renderResult() {
  renderResultView(drafts[mode].result, mode);
  renderSignatureView(drafts[mode].result, mode);
  updateForm();
}
function setBusy(value, label = '処理中…') {
  busy = value;
  for (const node of $('main-form').querySelectorAll('button,input,textarea,select'))
    node.disabled = value;
  $('cancel-button').disabled = false;
  if (value) {
    $('run-label').textContent = label;
    announce(label);
  }
  renderSignatureView(drafts[mode].result, mode);
  updateForm();
}
function cancelWork() {
  clearTimeout(decryptTimer);
  if (mode === 'decrypt' && hasValue('decrypt') && hasValue('secret')) decryptChecked = true;
  cipherMotion.reset();
  job++;
  controller?.abort();
  controller = null;
  cancelCrypto();
  const verification = drafts[mode].result?.verification;
  if (verification?.state === 'pending') {
    verification.state = 'unavailable';
    verification.message = 'GitHubとの照合を中止しました。';
  }
  setBusy(false);
}
function invalidate(which = mode) {
  drafts[which].result = null;
  clearErrors();
  if (which === mode) renderResult();
  else updateForm();
}
async function withJob(label, action, errorId = 'operation-error', automatic = false) {
  if (busy) return;
  clearErrors();
  const id = ++job;
  setBusy(true, label);
  let promptPassword = false;
  try {
    await action(() => id === job);
  } catch (error) {
    if (id === job && error.name !== 'AbortError') {
      cipherMotion.reset();
      if (mode === 'decrypt') decryptChecked = true;
      if (mode === 'decrypt' && error.code === 'PASSPHRASE_REQUIRED') {
        passwordNeeded = true;
        promptPassword = true;
        announce('秘密鍵のパスワードを入力してください。');
      } else {
        const target =
          error.field ||
          (mode === 'decrypt' && /秘密鍵|パスフレーズ/.test(error.message)
            ? 'secret-error'
            : errorId);
        errorAt(
          target,
          error.message.replaceAll('パスフレーズ', 'パスワード'),
          error.input,
          !automatic,
        );
      }
    }
  } finally {
    if (id === job) setBusy(false);
  }
  if (promptPassword && id === job) $('passphrase').focus();
}
function showManualKey(reason = '相手から受け取った公開鍵を入力してください。') {
  manualOpen = true;
  $('recipient-reason').textContent = reason;
  updateForm();
}
function resetDecryptCheck() {
  clearTimeout(decryptTimer);
  passwordNeeded = false;
  decryptChecked = false;
  $('passphrase').value = '';
}
function scheduleDecrypt() {
  clearTimeout(decryptTimer);
  if (
    mode !== 'decrypt' ||
    busy ||
    decryptChecked ||
    drafts.decrypt.result ||
    !hasValue('decrypt') ||
    !hasValue('secret')
  )
    return;
  decryptTimer = setTimeout(() => performOperation(true), 600);
}
async function resolveRecipient(current) {
  const manual = manualOpen && hasValue('recipient');
  try {
    let source, keys;
    if (manual) {
      const value = valueOf('recipient');
      if (byteLength(value) > MAX_KEY_BYTES) throw new Error('公開鍵は1 MB以下にしてください。');
      const text = typeof value === 'string' ? value : new TextDecoder().decode(value);
      if (text.includes('PRIVATE KEY'))
        throw new Error('公開鍵を指定してください。秘密鍵は使いません。');
      const pgp = text.includes('BEGIN PGP') || (value instanceof Uint8Array && value[0] >= 128);
      keys = await runCrypto(
        'inspect',
        pgp
          ? { pgp: [value] }
          : {
              ssh: text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => line && !line.startsWith('#')),
            },
      );
    } else {
      controller = new AbortController();
      $('run-label').textContent = '鍵を取得中…';
      source = await resolveGitHub($('github-user').value, {
        signal: controller.signal,
      });
      if (!current()) return null;
      if (source.errors.length) {
        showManualKey(
          'GitHubから公開鍵を取得できませんでした。相手から受け取った公開鍵を入力してください。',
        );
        return null;
      }
      keys = await runCrypto('inspect', { pgp: source.pgp, ssh: source.ssh });
    }
    if (!current()) return null;
    const format = source?.preferred || (keys.pgp.length ? 'pgp' : 'ssh');
    if (!keys[format]?.length) {
      if (!manual) {
        showManualKey(
          'GitHubに使える公開鍵が見つかりませんでした。相手から受け取った公開鍵を入力してください。',
        );
        return null;
      }
      throw new Error(
        keys.messages[0] ||
          '暗号化に使える公開鍵がありません。GPGまたはSSHの公開鍵を確認してください。',
      );
    }
    return { format, keys: keys[format].map((key) => key.key), username: source?.username };
  } catch (error) {
    error.field = 'recipient-error';
    error.input = manual ? 'recipient-text' : 'github-user';
    throw error;
  }
}
async function checkSignature(result, current) {
  const verification = result.verification;
  verification.state = 'pending';
  delete verification.message;
  renderSignatureView(result, mode);
  updateForm();
  controller = new AbortController();
  try {
    const source = await resolveGitHub(verification.github, {
      signal: controller.signal,
      keyType: verification.type,
      fresh: true,
    });
    if (!current()) return;
    if (source.errors.length) throw new Error(source.errors.join(' '));
    const checked = await runCrypto('verify-github', {
      verification,
      registeredKeys: source[verification.type],
    });
    if (!current()) return;
    verification.state = checked.matched ? 'verified' : 'mismatch';
    verification.checkedAt = new Date().toISOString();
  } catch (error) {
    if (!current()) return;
    verification.state = 'unavailable';
    verification.message =
      'GitHubとの照合が完了していません。 ' +
      (error.name === 'AbortError' ? '中止しました。' : error.message);
  }
  renderSignatureView(result, mode);
  updateForm();
  announce($('signature-status-title').textContent);
}
function performOperation(automatic = false) {
  if (busy || $('run-button').disabled) return;
  clearTimeout(decryptTimer);
  const operation = mode;
  if (operation === 'decrypt') decryptChecked = true;
  invalidate();
  cipherMotion.start(operation);
  withJob(
    operation === 'encrypt' ? '暗号化中…' : '復号中…',
    async (current) => {
      const value = valueOf(operation);
      let result;
      if (operation === 'encrypt') {
        const recipient = await resolveRecipient(current);
        if (!recipient || !current()) {
          cipherMotion.reset();
          return;
        }
        $('run-label').textContent = '暗号化中…';
        result = await runCrypto('encrypt', {
          data: typeof value === 'string' ? new TextEncoder().encode(value) : value,
          recipients: recipient.keys,
          format: recipient.format,
          filename: drafts.encrypt.kind === 'file' ? drafts.encrypt.file.name : 'message.txt',
          armored: drafts.encrypt.kind === 'text',
        });
        result.recipient = recipient.username ? '@' + recipient.username : '';
      } else
        result = await runCrypto('decrypt', {
          data: value,
          privateKey: valueOf('secret'),
          passphrase: $('passphrase').value,
          sourceName: drafts.decrypt.file?.name || '',
        });
      if (!current()) return;
      drafts[operation].result = result;
      renderResult();
      if (result.verification) await checkSignature(result, current);
      if (!current()) return;
      cipherMotion.finish(true);
      $('result-title').focus({ preventScroll: true });
      $('workspace').scrollIntoView({ block: 'nearest', behavior: 'instant' });
      announce(operation === 'encrypt' ? '暗号化しました。' : '復号しました。');
    },
    'operation-error',
    automatic,
  );
}
$('main-form').addEventListener('submit', (event) => {
  event.preventDefault();
  performOperation();
});
function switchMode(next, focus = false) {
  if (next === mode) return;
  cipherMotion.reset();
  clearTimeout(decryptTimer);
  if (busy) cancelWork();
  mode = next;
  clearErrors();
  renderResult();
  scheduleDecrypt();
  if (focus) $(mode + '-tab').focus();
}
for (const node of document.querySelectorAll('.operation-tabs [data-operation]')) {
  node.addEventListener('click', () => switchMode(node.dataset.operation));
  node.addEventListener('keydown', (event) => {
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
}
for (const kind of Object.keys(drafts)) {
  $(kind + '-text').addEventListener('input', () => {
    if (ownerOf(kind) === 'decrypt') resetDecryptCheck();
    invalidate(ownerOf(kind));
    scheduleDecrypt();
  });
  $(kind + '-file').addEventListener('change', (event) => loadFile(kind, event.target.files[0]));
  $(kind + '-file-remove').addEventListener('click', () => {
    drafts[kind].file = null;
    drafts[kind].kind = 'text';
    $(kind + '-file').value = '';
    if (ownerOf(kind) === 'decrypt') resetDecryptCheck();
    invalidate(ownerOf(kind));
    scheduleDecrypt();
    $(kind + '-text').focus();
  });
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
    if (busy) return;
    if (event.dataTransfer.files.length !== 1)
      errorAt(
        kind === 'secret'
          ? 'secret-error'
          : kind === 'recipient'
            ? 'recipient-error'
            : kind + '-error',
        'ファイルは1つずつ選択してください。',
      );
    else loadFile(kind, event.dataTransfer.files[0]);
  });
}
async function loadFile(kind, file) {
  if (!file || busy) return;
  const errorId =
    kind === 'secret' ? 'secret-error' : kind === 'recipient' ? 'recipient-error' : kind + '-error';
  const limit =
    kind === 'encrypt' ? MAX_BYTES : kind === 'decrypt' ? MAX_ENCRYPTED_BYTES : MAX_KEY_BYTES;
  if (file.size > limit) {
    errorAt(errorId, `ファイルは${limit / 1024 ** 2} MB以下にしてください。`);
    $(kind + '-file').value = '';
    return;
  }
  let loadedJob;
  await withJob(
    '読込中…',
    async (current) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!current()) return;
      drafts[kind].file = { bytes, name: file.name };
      drafts[kind].kind = 'file';
      if (ownerOf(kind) === 'decrypt') resetDecryptCheck();
      invalidate(ownerOf(kind));
      loadedJob = job;
    },
    errorId,
  );
  $(kind + '-file').value = '';
  if (loadedJob === job) scheduleDecrypt();
}
for (const id of ['github-user', 'passphrase'])
  $(id).addEventListener('input', () => {
    if (id === 'github-user') manualOpen = false;
    invalidate(id === 'passphrase' ? 'decrypt' : 'encrypt');
  });
$('manual-key-button').addEventListener('click', () => {
  showManualKey();
  $('recipient-text').focus();
});
$('github-key-button').addEventListener('click', () => {
  drafts.recipient = { kind: 'text', file: null, result: null };
  $('recipient-text').value = '';
  $('recipient-file').value = '';
  $('github-user').value = '';
  manualOpen = false;
  invalidate('encrypt');
  $('github-user').focus();
});
$('main-form').addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !busy) {
    event.preventDefault();
    $('main-form').requestSubmit();
  }
});
$('cancel-button').addEventListener('click', () => {
  cancelWork();
  announce('中止しました。');
});
$('result-cancel-button').addEventListener('click', cancelWork);
$('retry-verification').addEventListener('click', () => {
  const result = drafts.decrypt.result;
  if (mode === 'decrypt' && result?.verification && !busy)
    withJob('照合中…', (current) => checkSignature(result, current));
});
$('edit-result-button').addEventListener('click', () => {
  cancelWork();
  invalidate();
  const kind = drafts[mode].kind;
  $(mode + (kind === 'file' ? '-file-remove' : '-text')).focus();
});
$('copy-button').addEventListener('click', async () => {
  const result = drafts[mode].result;
  if (!result || result.text === null || $('copy-button').disabled) return;
  try {
    await navigator.clipboard.writeText(result.text);
    if (drafts[mode].result !== result) return;
    $('result-error').hidden = true;
    $('copy-label').textContent = 'コピーしました';
    announce('コピーしました。');
  } catch {
    if (drafts[mode].result !== result) return;
    if (result.text.length > 100000) {
      errorAt('result-error', 'コピーできませんでした。全文はファイルに保存してください。');
      $('save-button').focus();
      return;
    }
    $('result-text').focus();
    const range = document.createRange();
    range.selectNodeContents($('result-text'));
    const selection = getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    $('copy-label').textContent = '選択してコピー';
    announce('選択した文字をコピーしてください。');
  }
});
$('save-button').addEventListener('click', () => {
  const result = drafts[mode].result;
  if (!result || $('save-button').disabled) return;
  const url = URL.createObjectURL(new Blob([result.bytes], { type: 'application/octet-stream' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = result.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
});
$('clear-button').addEventListener('click', () => {
  cancelWork();
  recipientPreview.reset();
  manualOpen = false;
  resetDecryptCheck();
  clearGitHubKeyCache();
  for (const kind of Object.keys(drafts)) {
    drafts[kind] = { kind: 'text', file: null, result: null };
    $(kind + '-text').value = '';
    $(kind + '-file').value = '';
  }
  $('github-user').value = '';
  $('passphrase').value = '';
  clearErrors();
  renderResult();
  $(mode + '-text').focus();
  announce('入力と鍵を消去しました。');
});
$('help-button').addEventListener('click', () => $('help-dialog').showModal());
$('help-close').addEventListener('click', () => $('help-dialog').close());
document.addEventListener('dragover', (event) => {
  if (event.dataTransfer.types.includes('Files')) event.preventDefault();
});
document.addEventListener('drop', (event) => event.preventDefault());
renderResult();
