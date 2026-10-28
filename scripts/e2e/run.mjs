import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const output = resolve('test-results/container');
await mkdir(output, { recursive: true });
const image = `fumi-terminal-e2e:run-${process.pid}`;
const docker = (args) => {
  const result = spawnSync('docker', args, { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Docker exited ${result.status ?? result.signal}`);
};
try {
  docker(['build', '-q', '-t', image, '-f', 'scripts/e2e/Dockerfile', '.']);
  docker([
    'run',
    '--rm',
    '--init',
    '--shm-size=512m',
    '--mount',
    `type=bind,source=${output},target=/app/test-results/container`,
    ...(process.env.FUMI_E2E_CASE ? ['-e', `FUMI_E2E_CASE=${process.env.FUMI_E2E_CASE}`] : []),
    image,
  ]);
} finally {
  spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore' });
}
