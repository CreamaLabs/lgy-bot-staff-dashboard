import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';

if (!existsSync('public/index.html')) {
  throw new Error('public/index.html is missing');
}

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist/server', { recursive: true });
cpSync('public', 'dist/client', { recursive: true });
cpSync('src/worker.js', 'dist/server/index.js');
console.log('LGY Bot dashboard is ready for Cloudflare.');
