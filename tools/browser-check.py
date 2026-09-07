"""Optional real-WebGPU acceptance smoke test. Start `npm start` first.

Requires Python Playwright and a supported, hardware-accelerated Chromium browser.
No browser policies, security settings, or GPU blocklists are changed. A blocked
navigation or unavailable GPU is reported as NOT_RUN, never as a passing render.
"""
import argparse
import json
import pathlib
import sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--url', default='http://127.0.0.1:5173/')
parser.add_argument('--chromium', help='Optional path to a Chromium/Chrome executable')
parser.add_argument('--headed', action='store_true', help='Use a visible browser (recommended for hardware WebGPU)')
parser.add_argument('--timeout', type=int, default=120000, help='Page/model timeout, milliseconds')
args = parser.parse_args()
report = {'scope': 'Real browser startup and WebGPU frame/picking/capture smoke test',
          'url': args.url, 'status': 'NOT_RUN', 'checks': [], 'pageErrors': [], 'gpuErrors': []}
exit_code = 2
try:
    with sync_playwright() as p:
        options = {'headless': not args.headed}
        if args.chromium:
            options['executable_path'] = args.chromium
        browser = p.chromium.launch(**options)
        page = browser.new_page(viewport={'width': 1500, 'height': 980}, device_scale_factor=1)
        page.on('pageerror', lambda e: report['pageErrors'].append(str(e)))
        page.goto(args.url, wait_until='domcontentloaded', timeout=args.timeout)
        page.wait_for_function('globalThis.singletake && document.querySelector("#loading").classList.contains("hidden")', timeout=args.timeout)
        state = page.evaluate('''() => {
            const a = singletake;
            return {ready: a.ready, nodes: a.doc.project.nodes.length,
              error: document.querySelector('#gpu-error')?.innerText || null};
        }''')
        report['startup'] = state
        if not state['ready']:
            report['reason'] = state['error'] or 'No initialized WebGPU renderer.'
        else:
            page.wait_for_function('singletake.renderer.stats.triangles > 0', timeout=args.timeout)
            report['checks'].append('Bundled Home.skp imports and submits nonempty geometry')
            # Exercise distinct pipelines, clipping, picking and the PNG readback path.
            page.evaluate('''async () => {
                const a=singletake,r=a.renderer;
                for (const style of [0,1,2,3]) {
                    r.style=style;r.requestRender();
                    await new Promise(resolve=>setTimeout(resolve,120));
                }
                r.style=0;a.doc.project.section.enabled=true;
                a.doc.project.section.value=1.3;r.requestRender();
                await new Promise(resolve=>setTimeout(resolve,120));
                a.doc.project.section.enabled=false;r.requestRender();
                await r.device.queue.onSubmittedWorkDone();
            }''')
            report['checks'].append('Style and section-clipping render paths exercised')
            # A miss is legitimate at the screen center; this checks readback execution.
            report['pick'] = page.evaluate('''async () => {
                const r=singletake.renderer;
                const rect=r.canvas.getBoundingClientRect();
                const result=await r.pick(rect.width/2,rect.height/2);
                return result ? 'hit' : 'miss';
            }''')
            png = page.evaluate('''async () => {
                const b=await singletake.renderer.screenshot();
                return {type:b.type,bytes:b.size};
            }''')
            assert png['type'] == 'image/png' and png['bytes'] > 100, 'PNG readback failed'
            report['checks'].append('GPU picking and nonempty PNG readback complete')
            report['png'] = png
            page.wait_for_timeout(400)
            report['stats'] = page.evaluate('singletake.renderer.stats')
            report['gpuErrors'] = page.evaluate('[...singletake.gpuErrors]')
            report['status'] = 'PASS' if not (report['pageErrors'] or report['gpuErrors']) else 'FAIL'
            page.screenshot(path=str(ROOT/'docs/viewport-check.png'), full_page=True)
            exit_code = 0 if report['status'] == 'PASS' else 1
        browser.close()
except Exception as exc:
    report['reason'] = str(exc)
    if report['checks']:
        report['status'] = 'FAIL'
        exit_code = 1
finally:
    (ROOT/'docs').mkdir(exist_ok=True)
    (ROOT/'docs/browser-smoke-report.json').write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))
sys.exit(exit_code)
