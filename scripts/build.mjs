#!/usr/bin/env node
import { execSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
const distDir = join(projectRoot, 'dist');
const seaConfigPath = join(projectRoot, 'sea-config.json');
const blobPath = join(distDir, 'mango.blob');
const outputBinary = join(distDir, 'mango');

mkdirSync(distDir, { recursive: true });

execSync(`node --experimental-sea-config ${JSON.stringify(seaConfigPath)}`, {
  stdio: 'inherit'
});

copyFileSync(process.execPath, outputBinary);

try {
  const postjectCommand = [
    'npx --yes postject',
    JSON.stringify(outputBinary),
    'NODE_SEA_BLOB',
    JSON.stringify(blobPath),
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2 '
  ].join(' ');

  execSync(postjectCommand, { stdio: 'inherit' });
} catch (error) {
  throw new Error(
    'Failed to embed the SEA blob using postject. Ensure you have access to the npm registry or install postject manually.',
    { cause: error }
  );
}

chmodSync(outputBinary, 0o755);

console.log(`Created single executable at ${outputBinary}`);
