import { readFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..') + sep;
const url = new URL(process.env.FUMI_URL || 'http://127.0.0.1:3000/');
if (!['http:', 'https:'].includes(url.protocol))
  throw new Error('FUMI_URL must be an HTTP(S) URL.');
const suite = process.argv[2] === 'motion' ? 'motion-scenarios.mjs' : 'scenarios.mjs';
const source = (await readFile(new URL('./browser/' + suite, import.meta.url), 'utf8'))
  .replaceAll('__FUMI_ROOT__', JSON.stringify(root))
  .replaceAll('__FUMI_URL__', JSON.stringify(url.href))
  .replaceAll('__FUMI_KEEP__', JSON.stringify(Boolean(process.env.FUMI_TASK)))
  .replaceAll(
    '__FUMI_TASK__',
    JSON.stringify(
      process.env.FUMI_TASK ? Number(process.env.FUMI_TASK) : `fumi-browser-${Date.now()}`,
    ),
  );
const result = spawnSync('ego-browser', ['nodejs'], {
  input: source,
  stdio: ['pipe', 'inherit', 'inherit'],
  maxBuffer: 16 * 1024 ** 2,
});
if (result.error) throw result.error;
process.exitCode = result.status || (result.signal ? 1 : 0);
