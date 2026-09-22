#!/usr/bin/env python3
"""生成 README/教程使用的管理面板截图。

前提：先 `pnpm build`（本脚本读取 dist/index.html 的当前哈希）。
用法：python3 scripts/gen-screenshots.py [--mock-only]
输出：docs/images/panel-*.png（六个面板页）。
"""
import re, subprocess, time, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = f'{ROOT}/apps/extension/dist'
OUT = f'{ROOT}/docs/images'
CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
PORT = 8793

index = open(f'{DIST}/index.html', encoding='utf-8').read()
mod = re.search(r'src="(/assets/dashboard-[^"]+\.js)"', index).group(1)

stub = open(f'{ROOT}/scripts/screenshot-stub.js', encoding='utf-8').read()
html = index.replace(
    f'<script type="module" crossorigin src="{mod}"></script>',
    '<script src="/_stub.js"></script>' + f'<script type="module" crossorigin src="{mod}"></script>')
open(f'{DIST}/_shot_base.html', 'w', encoding='utf-8').write(html)
open(f'{DIST}/_stub.js', 'w', encoding='utf-8').write(stub)

server = subprocess.Popen(['python3', '-m', 'http.server', str(PORT)], cwd=DIST,
                          stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
views = ['triggered', 'blockedLog', 'whitelist', 'rules', 'logs', 'settings']
for v in views:
    subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
        '--force-device-scale-factor=2', '--window-size=1280,1600',
        '--virtual-time-budget=8000',
        f'--screenshot={OUT}/panel-{v}.png',
        f'http://127.0.0.1:{PORT}/_shot_base.html?view={v}'], capture_output=True, timeout=120)
server.terminate()
# 清理：打包与构建都不应包含 harness
for f in ['_shot_base.html', '_stub.js']:
    os.remove(f'{DIST}/{f}')
print('screenshots regenerated:', ', '.join(views))
