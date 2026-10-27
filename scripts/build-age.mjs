import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cwd = join(root, 'crypto/age');
const vendor = join(root, 'src/vendor');
const go = process.env.GO || 'go';
const run = (args, options = {}) => execFileSync(go, args, { cwd, encoding: 'utf8', ...options });
await mkdir(vendor, { recursive: true });
run(['mod', 'download']);
run(['build', '-trimpath', '-ldflags=-s -w', '-o', join(vendor, 'age.wasm'), '.'], {
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm', CGO_ENABLED: '0' },
});
const goroot = run(['env', 'GOROOT']).trim();
await copyFile(join(goroot, 'lib/wasm/wasm_exec.js'), join(vendor, 'wasm_exec.js'));
const modules = run(['list', '-deps', '-f', '{{if .Module}}{{.Module.Path}}{{end}}', '.'], {
  env: { ...process.env, GOOS: 'js', GOARCH: 'wasm' },
});
const dependencies = [...new Set(modules.trim().split(/\s+/))]
  .filter((name) => name !== 'dgpg.local/agebridge')
  .sort();
let licenses = `Official age and SSHSIG browser engine\nBuilt with ${run(['version']).trim()}\n\nGo runtime and wasm_exec.js\n${await readFile(join(goroot, 'LICENSE'), 'utf8')}`;
for (const dependency of dependencies) {
  const metadata = JSON.parse(run(['list', '-m', '-json', dependency]));
  licenses += `\n\n${metadata.Path} ${metadata.Version}\n${await readFile(join(metadata.Dir, 'LICENSE'), 'utf8')}`;
}
await writeFile(join(vendor, 'age-LICENSE'), licenses);
console.log('Built src/vendor/age.wasm with matching wasm_exec.js and upstream licenses.');
