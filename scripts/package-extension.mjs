#!/usr/bin/env node
/**
 * Package the built extension (apps/extension/dist) into a release zip at the
 * repo root: xshield-v<version>.zip, with the dist files at the archive root
 * so unzipping yields a folder (named after the zip) that contains
 * manifest.json — load it directly in chrome://extensions.
 *
 * Requires `pnpm build` to have run first, and the `zip` CLI (present on
 * macOS/Linux and the GitHub Actions ubuntu runners).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, rmSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'apps', 'extension', 'dist');

if (!existsSync(join(distDir, 'manifest.json'))) {
  console.error('apps/extension/dist/manifest.json not found — run `pnpm build` first.');
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(join(distDir, 'manifest.json'), 'utf8'));
const version = manifest.version;
const zipPath = join(root, `xshield-v${version}.zip`);

rmSync(zipPath, { force: true });
execFileSync('zip', ['-r', zipPath, '.'], { cwd: distDir, stdio: 'inherit' });

console.log(`Packaged ${zipPath} from ${distDir} (${version})`);