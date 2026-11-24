// 画面（Web 版）をビルドして desktop/app にコピーする
// 使い方: node prepare.cjs   （対戦サーバーの URL は TMJ_SERVER_URL で変更可能）
const { execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const server = process.env.TMJ_SERVER_URL || 'https://transparent-mahjong-web.alones-aqua.workers.dev';
execSync('npm run build', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_SERVER_URL: server, VITE_PLATFORM: 'steam' },
});
const out = path.join(__dirname, 'app');
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(root, 'dist'), out, { recursive: true });
// PC版ではオフライン用の Service Worker は不要
fs.rmSync(path.join(out, 'sw.js'), { force: true });
fs.mkdirSync(path.join(__dirname, 'build'), { recursive: true });
fs.copyFileSync(path.join(root, 'public', 'icon-512.png'), path.join(__dirname, 'build', 'icon.png'));
console.log(`desktop/app を作成しました（対戦サーバー: ${server}）`);
