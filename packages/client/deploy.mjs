#!/usr/bin/env node
/**
 * Rebuilds packages/client and republishes dist/ to the S3 + CloudFront static
 * hosting set up in the 2026-09-09-m1-client-deploy session. Run this any time
 * client code changes and needs to reach the deployed URL.
 *
 * Requires the AWS CLI installed and a profile with permissions scoped to the
 * client bucket + this CloudFront distribution (see the tichu-frontend-deploy
 * IAM user). Override the profile with `--profile <name>`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const CLIENT_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = join(CLIENT_DIR, 'dist');
const ASSETS_DIR = join(DIST_DIR, 'assets');

const BUCKET = 'tichu-client-737213639049-ap-southeast-2-an';
const DISTRIBUTION_ID = 'E101LMR0OATAZ4';
const DEFAULT_PROFILE = 'tichu-frontend-deploy';

const profileFlagIndex = process.argv.indexOf('--profile');
const profile = profileFlagIndex !== -1 ? process.argv[profileFlagIndex + 1] : DEFAULT_PROFILE;

function run(cmd, args, { shell = true } = {}) {
  console.log(`$ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', shell });
}

// `shell: false` here: with `shell: true` on Windows, Node joins `args` with a
// naive space-join before handing the line to cmd.exe, instead of quoting each
// argv element -- any value containing its own spaces (e.g. the `Cache-Control`
// header values below, `'no-cache, must-revalidate'`) silently splits into
// multiple argv tokens, which aws.exe then rejects as unknown options. aws.exe
// is a real executable (not a .cmd shim needing cmd.exe to interpret it,
// unlike `pnpm` in the build step above), so spawning it directly lets Node's
// own Windows argv-escaping quote each element correctly.
function aws(args) {
  run('aws', [...args, '--profile', profile], { shell: false });
}

console.log('1) 클라이언트 빌드 (packages/client/.env.production 값 반영)');
run('pnpm', ['--filter', 'client', 'build']);

console.log('2) public/models 유래 불필요 산출물 제거 (프로덕션은 VITE_MODEL_BASE_URL에서 모델을 받아옴)');
const distModels = join(DIST_DIR, 'models');
if (existsSync(distModels)) {
  rmSync(distModels, { recursive: true, force: true });
}

console.log('3) ONNX 런타임 WASM 자산 gzip 압축 (제자리, 파일명 유지)');
const wasmFile = readdirSync(ASSETS_DIR).find((f) => /^ort-wasm-simd-threaded.*\.wasm$/.test(f));
if (!wasmFile) {
  throw new Error('dist/assets/ 안에서 ort-wasm-simd-threaded*.wasm 파일을 찾지 못했습니다.');
}
const wasmPath = join(ASSETS_DIR, wasmFile);
const original = readFileSync(wasmPath);
const compressed = gzipSync(original, { level: 9 });
writeFileSync(wasmPath, compressed);
console.log(`   ${wasmFile}: ${original.length.toLocaleString()} -> ${compressed.length.toLocaleString()} bytes`);

console.log('4) index.html 업로드 (짧은 캐시 -- 재배포가 바로 반영되도록)');
aws([
  's3', 'cp',
  join(DIST_DIR, 'index.html'),
  `s3://${BUCKET}/index.html`,
  '--cache-control', 'no-cache, must-revalidate',
  '--content-type', 'text/html',
]);

console.log('5) 해시 붙은 assets/* 업로드 (WASM 제외, 장기 캐시)');
aws([
  's3', 'sync',
  ASSETS_DIR,
  `s3://${BUCKET}/assets`,
  '--exclude', wasmFile,
  '--cache-control', 'public, max-age=31536000, immutable',
  '--delete',
]);

console.log('6) 압축된 WASM 업로드 (Content-Encoding 명시 -- 없으면 브라우저가 깨진 바이너리로 받음)');
aws([
  's3', 'cp',
  wasmPath,
  `s3://${BUCKET}/assets/${wasmFile}`,
  '--content-encoding', 'gzip',
  '--content-type', 'application/wasm',
  '--cache-control', 'public, max-age=31536000, immutable',
]);

console.log('7) CloudFront 캐시 무효화 (index.html)');
aws(['cloudfront', 'create-invalidation', '--distribution-id', DISTRIBUTION_ID, '--paths', '/index.html']);

console.log('\n완료. https://d3eaqeztt5cahh.cloudfront.net 에서 확인하세요 (무효화 반영까지 1~수 분 소요).');
