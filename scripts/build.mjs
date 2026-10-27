import { build, transform } from 'esbuild';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename } from 'node:path';

const [template, css, license, ageLicense, zipLicense] = await Promise.all([
  readFile(new URL('../src/template.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../node_modules/openpgp/LICENSE', import.meta.url), 'utf8'),
  readFile(new URL('../src/vendor/age-LICENSE', import.meta.url), 'utf8'),
  readFile(new URL('../node_modules/fflate/LICENSE', import.meta.url), 'utf8'),
]);
const options = {
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: ['es2022'],
  loader: { '.wasm': 'binary' },
  minify: true,
  legalComments: 'inline',
  charset: 'utf8',
};
const worker = await build({
  ...options,
  entryPoints: ['src/crypto-worker.js'],
  outdir: 'public/assets',
  entryNames: 'crypto-worker-[hash]',
});
const workerCode = worker.outputFiles[0].text;
const workerURL = '/assets/' + basename(worker.outputFiles[0].path);
await rm(new URL('../public/assets/', import.meta.url), { recursive: true, force: true });
await mkdir(new URL('../public/assets/', import.meta.url), { recursive: true });
await writeFile(worker.outputFiles[0].path, workerCode);

const styles = (await transform(css, { loader: 'css', minify: true })).code;
const hash = (value) => `'sha256-${createHash('sha256').update(value).digest('base64')}'`;
const escapeHtml = (value) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
async function render(source) {
  const web = source === 'server';
  const bundle = await build({
    ...options,
    entryPoints: ['src/app.js'],
    define: {
      __WORKER_URL__: web ? JSON.stringify(workerURL) : 'null',
      __WORKER_CODE__: web ? '""' : JSON.stringify(workerCode),
    },
  });
  const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const csp = `default-src 'none'; script-src ${hash(script)} 'wasm-unsafe-eval'; style-src ${hash(styles)}; worker-src ${web ? "'self'" : 'blob:'}; connect-src ${web ? "'self'" : 'https://api.github.com'}; img-src 'none'; font-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  const description = web
    ? '公開鍵は、このサーバーを経由してGitHubの .gpg / .keys 公開ページから取得します。サーバーに送るのはGitHubユーザー名と鍵の種類だけです。本文・ファイル・秘密鍵・パスフレーズは送信しません。'
    : '公開鍵はGitHubの公式APIから取得します。このファイル版ではAPIの取得制限が適用されます。本文・ファイル・秘密鍵・パスフレーズは送信しません。';
  return template
    .replace('__CSP__', () => csp)
    .replace('__KEY_SOURCE__', source)
    .replace('__KEY_DESCRIPTION__', description)
    .replace(/<style>\s*__STYLES__\s*<\/style>/, () => `<style>${styles}</style>`)
    .replace('__LICENSE__', () =>
      escapeHtml(
        'OpenPGP.js 6.3.2\n\n' +
          license +
          '\n\n' +
          ageLicense +
          '\n\nfflate 0.8.3\n\n' +
          zipLicense,
      ),
    )
    .replace(/<script>\s*__SCRIPT__;?\s*<\/script>/, () => `<script>${script}</script>`);
}
const [standalone, web] = await Promise.all([render('github-api'), render('server')]);
await writeFile(new URL('../index.html', import.meta.url), standalone);
await mkdir(new URL('../.generated/', import.meta.url), { recursive: true });
await writeFile(new URL('../.generated/web.html', import.meta.url), web);
console.log(
  `Built Fumi: web ${(Buffer.byteLength(web) / 1024).toFixed(0)} KiB, standalone ${(Buffer.byteLength(standalone) / 1024 ** 2).toFixed(2)} MiB. Cryptography remains in the browser.`,
);
