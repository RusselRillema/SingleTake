"""Exercise the actual packaged desktop JS using its canonical HTML/CSS and App.
Only native GPU and OS services are test doubles. Chromium supplies the DOM; this
is NOT evidence of WebScene CSS conformance, C# execution or native rendering.
Run `npm run desktop:bundle` first. Optional test dependency: Python Playwright.
"""
import json, pathlib, os, shutil, hashlib
from playwright.sync_api import sync_playwright
ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'test-results'
OUT.mkdir(exist_ok=True)
BUNDLE = ROOT / 'desktop/SingleTake.Desktop/Components/Modeler'
checks, errors = [], []

HOST = r'''
window.hostTest={calls:[],lastFrame:null,frames:0,inFlight:0,maxInFlight:0,saveResult:true,saved:[],files:[],recovery:null};
window.webscene={host:{commands:{invoke:async(method,args)=>{
 const t=hostTest;t.calls.push(method);
 switch(method){
 case 'frame':
  t.inFlight++;t.maxInFlight=Math.max(t.maxInFlight,t.inFlight);
  await new Promise(resolve=>setTimeout(resolve,5));t.frames++;t.lastFrame=args;t.inFlight--;
  return {accepted:args.serial};
 case 'ready':t.ready=args;return {native:true,ui:'shared'};
 case 'open':{const files=t.files;t.files=[];return {files};}
 case 'save':t.saved.push(args);return {saved:t.saveResult};
 case 'recovery.save':t.recovery=args.data;return {saved:true};
 case 'recovery.load':return {data:t.recovery};
 case 'recovery.clear':t.recovery=null;return {cleared:true};
 default:throw Error('Unexpected host service in test: '+method);
 }
}}}};
'''

def mark(name):
    checks.append(name)
    print('PASS:', name, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium'), headless=True)
    page = browser.new_page(viewport={'width':1500,'height':980}, device_scale_factor=2)
    page.set_default_timeout(12000)
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.set_content('<!doctype html><html><head><title>Shared UI acceptance</title></head><body></body></html>')
    page.add_script_tag(content=HOST)
    page.add_script_tag(content=(BUNDLE/'main.js').read_text())
    page.evaluate('mount()')
    page.wait_for_function('hostTest.lastFrame !== null')

    report = page.evaluate('SingleTakeDesktop.diagnostics()')
    for path, actual in report['sources'].items():
        assert hashlib.sha256((ROOT/path).read_bytes()).hexdigest() == actual, path
    assert page.evaluate('document.querySelector("#singletake-shared-styles").textContent') == (ROOT/'style.css').read_text()
    for path in ['index.html','style.css']:
        assert (BUNDLE/'ui'/path).read_bytes() == (ROOT/path).read_bytes()
    assert report['ui'] == 'shared' and report['controller'] == 'src/app.js'
    assert page.locator('.tool-rail').count()==1 and page.locator('.inspector').count()==1
    assert page.locator('#measurement-input').count()==1
    mark('Packaged HTML and CSS are byte-identical to web sources; original App and full workspace mount')

    def check_rect():
        page.wait_for_function('''() => {const r=document.querySelector('#canvas').getBoundingClientRect(),v=hostTest.lastFrame.viewport;return Math.abs(r.x-v.left)<.01&&Math.abs(r.y-v.top)<.01&&Math.abs(r.width-v.width)<.01&&Math.abs(r.height-v.height)<.01;}''')
        assert page.evaluate('canvas.width===Math.round(canvas.getBoundingClientRect().width*devicePixelRatio)')
    check_rect()
    page.set_viewport_size({'width':1280,'height':860})
    check_rect()
    page.set_viewport_size({'width':1500,'height':980})
    check_rect()
    mark('GPU rectangle follows the real DOM canvas after resize, using CSS coordinates and 2x display scale')

    def command(search):
        page.locator('#command-button').click()
        page.locator('#command-search').fill(search)
        page.locator('#command-results button').first.click()

    command('Create box')
    page.locator('input[name="dimensions"]').fill('2 m, 3 m, 4 m')
    page.locator('button',has_text='Create box').click()
    page.wait_for_function('singletake.doc.project.nodes.length===1')
    assert page.evaluate('Object.values(singletake.doc.project.meshes)[0].faces.length')==6
    assert not page.locator('#dialog').is_visible()
    page.locator('#canvas').focus()
    page.keyboard.press('Shift+Z')
    mark('Canonical Commands menu and primitive dialog create exactly one box, then fit via shared shortcut')

    def screen(point):
        return page.evaluate('''p=>{const s=singletake.renderer.camera.project(p),r=singletake.canvas.getBoundingClientRect();return {x:r.left+s[0],y:r.top+s[1]};}''',point)
    def point_click(point, count=1):
        s=screen(point)
        page.mouse.click(s['x'],s['y'], click_count=count, delay=40)

    point_click([1,3,2])
    page.wait_for_function('singletake.face !== null')
    assert page.evaluate('singletake.selection.size')==1
    page.wait_for_timeout(650)
    point_click([1,3,2],2)
    page.wait_for_function('[...singletake.subSelection.values()][0].edges.size===4')
    mark('Actual canvas pointer events select a face and its boundary through shared CPU picking')

    # Do not let a focused inspector input consume modeling shortcuts.
    page.locator('#canvas').focus()
    page.keyboard.press('Control+A')
    page.keyboard.press('Control+G')
    page.wait_for_function('singletake.doc.project.nodes.length===2')
    page.wait_for_timeout(650)
    point_click([1,3,2],2)
    page.wait_for_function('!!singletake.editContext')
    assert page.locator('#editing-context').is_visible()
    page.locator('[data-action="close-context"]').click()
    page.wait_for_function('singletake.editContext===null')
    mark('Group shortcut, double-click edit context and original Done control use the same hierarchy')

    page.locator('[data-tab="materials"]').click()
    page.locator('[data-action="add-material"]').click()
    page.locator('[data-property="material-name"]').fill('Shared finish')
    page.locator('[data-property="material-name"]').press('Tab')
    page.wait_for_function('singletake.doc.project.materials.some(m=>m.name==="Shared finish")')
    page.locator('[data-tab="scenes"]').click()
    assert page.locator('#scenes-panel').is_visible()
    page.locator('[data-tab="model"]').click()
    mark('Original inspector tabs, material creation and text-field changes work in the desktop payload')

    # An active text field must not create a model, open a dialog or switch tools.
    before=page.evaluate('singletake.doc.project.nodes.length')
    tool=page.evaluate('singletake.tools.id')
    page.locator('#outliner-search').fill('')
    page.locator('#outliner-search').press('r')
    assert page.evaluate('singletake.tools.id')==tool
    assert page.evaluate('singletake.doc.project.nodes.length')==before
    page.locator('#outliner-search').fill('')
    mark('Typing in canonical text fields does not leak keyboard shortcuts into the world')

    # All shader styles share one numeric convention with the web controller.
    for label,value in [('Clay',1),('Wireframe',2),('Studio',0),('X-ray',3)]:
        page.locator(f'[data-style="{value}"]').click()
        page.wait_for_function(f'hostTest.lastFrame.style==={value}')
    page.locator('[data-style="0"]').click()
    mark('Studio, Clay, Wireframe and X-ray transmit the web controller style values unchanged')

    # OS save cancellation must never claim a file was saved or clear the dirty flag.
    page.evaluate('hostTest.saveResult=false')
    page.locator('#save-button').click()
    page.wait_for_function('hostTest.saved.length===1')
    assert page.evaluate('singletake.doc.dirty')
    page.evaluate('hostTest.saveResult=true')
    page.locator('#save-button').click()
    page.wait_for_function('!singletake.doc.dirty')
    page.evaluate('hostTest.files=[{name:hostTest.saved[1].name,data:hostTest.saved[1].data}]')
    page.locator('#open-button').click()
    page.wait_for_function('!singletake.loadingModel && singletake.doc.project.nodes.length===2')
    assert page.evaluate('singletake.doc.project.materials.some(m=>m.name==="Shared finish")')
    mark('Original Save/Open buttons use native file services, preserve cancellation and round-trip the edited model')

    # Held keys, camera navigation, snap coordinates, and push/pull use DOM events.
    page.locator('#canvas').focus()
    page.keyboard.press('Shift+Z')
    position=screen([1,3,2])
    saved=page.evaluate('JSON.stringify(singletake.renderer.camera.save())')
    page.mouse.move(position['x'],position['y'])
    page.mouse.down(button='middle')
    page.mouse.move(position['x']+45,position['y']+25,steps=5)
    page.mouse.up(button='middle')
    assert page.evaluate('JSON.stringify(singletake.renderer.camera.save())')!=saved
    saved=page.evaluate('JSON.stringify(singletake.renderer.camera.save())')
    page.keyboard.down('Shift')
    page.mouse.down(button='middle')
    page.mouse.move(position['x']+75,position['y']+35,steps=4)
    page.mouse.up(button='middle')
    page.keyboard.up('Shift')
    assert page.evaluate('JSON.stringify(singletake.renderer.camera.save())')!=saved
    before=page.evaluate('singletake.renderer.camera.distance')
    page.mouse.wheel(0,120)
    page.wait_for_function('singletake.renderer.camera.distance!=='+str(before))
    assert page.evaluate('singletake.tools.gesture') is None
    mark('Middle-drag orbit, Shift+middle pan, wheel zoom and modifier release work through the same canvas events')

    # Reset view and open the group to edit the original top cap.
    page.keyboard.press('Shift+Z')
    page.locator('#view-iso').click()
    page.locator('#canvas').focus()
    page.keyboard.press('Space')
    point_click([1,3,2],2)
    page.wait_for_function('!!singletake.editContext')
    page.keyboard.press('l')
    p0=screen([2,3,4]);page.mouse.move(p0['x'],p0['y'])
    page.wait_for_function('singletake.tools.snapInfo?.label==="Endpoint"')
    midpoint=screen([1,3,4]);page.mouse.move(midpoint['x'],midpoint['y'])
    page.wait_for_function('singletake.tools.snapInfo?.label==="Midpoint"')
    center=screen([1,3,2]);page.mouse.move(center['x'],center['y'])
    page.wait_for_function('singletake.tools.snapInfo?.label==="Face center"')
    page.mouse.click(p0['x'],p0['y'])
    page.keyboard.press('ArrowUp')
    assert page.evaluate('singletake.tools.axis')=='z'
    page.keyboard.down('Shift')
    assert page.evaluate('singletake.tools.lockedDirection')==[0,1,0]
    page.keyboard.up('Shift')
    assert page.evaluate('singletake.tools.lockedDirection') is None
    page.keyboard.press('Escape')
    mark('Projected endpoints, edge midpoints and face centers snap; arrow lock and held Shift inference use shared tools')

    page.keyboard.press('p')
    point_click([1,3,2])
    page.wait_for_function('singletake.tools.pending?.kind==="pushpull"')
    page.locator('#measurement-input').fill('1 m')
    page.locator('#measurement-input').press('Enter')
    page.wait_for_function('Math.abs(Math.max(...Object.values(singletake.doc.project.meshes)[0].vertices.map(v=>v[1]))-4)<1e-6')
    page.locator('#canvas').focus()
    page.keyboard.press('Control+Z')
    page.wait_for_function('Math.abs(Math.max(...Object.values(singletake.doc.project.meshes)[0].vertices.map(v=>v[1]))-3)<1e-6')
    mark('Face picking and precise Push/Pull move the cap outward; the original Undo shortcut restores it')

    # Deliberately exercise the bounded-runtime dialog fallback, not only Chrome's top layer.
    page.evaluate('document.querySelector("#dialog").showModal=undefined')
    page.locator('#units-button').click()
    assert page.locator('#dialog[data-modal-fallback][open]').count()==1
    page.locator('select[name="units"]').select_option('mm')
    page.locator('button',has_text='Apply settings').click()
    page.wait_for_function('singletake.doc.project.units==="mm"')
    assert page.locator('.dialog-backdrop').count()==0
    command('Create box')
    page.locator('input[name="dimensions"]').fill('1m,1m,1m')
    page.locator('input[name="dimensions"]').press('Enter')
    page.wait_for_function('!document.querySelector("#dialog").hasAttribute("open")')
    mark('Shared dialog fallback, form values, explicit submit and Enter work without browser modal defaults')

    # Serialize before disposing; remount must remove old listeners and restore actual project data.
    page.evaluate('singletake.closeModal();singletake.tools.cancel()')
    page.wait_for_function('hostTest.recovery!==null', timeout=15000)
    page.evaluate('singletake.platform.saveWorkspace(singletake.doc.project,singletake.renderer.camera.save())')
    old=page.evaluate('singletake.doc.project.id')
    page.evaluate('unmount()')
    assert page.locator('.topbar').count()==0
    page.evaluate('mount()')
    assert page.evaluate('singletake.doc.project.id')==old
    assert page.locator('.topbar').count()==1
    page.locator('#canvas').focus()
    old=page.evaluate('singletake.renderer.backEdges')
    page.keyboard.press('k')
    assert page.evaluate('singletake.renderer.backEdges')!=old
    assert page.evaluate('hostTest.maxInFlight')==1
    mark('Unmount/remount restores recovery without duplicate UI or shortcut listeners; frame transport stays bounded')
    page.locator('#command-button').click()
    page.locator('#command-search').fill('')
    page.screenshot(path=str(OUT/'shared-ui-dom.png'))
    page.evaluate('singletake.closeModal();unmount()')
    browser.close()

result={'scope':'Actual desktop JavaScript payload in Chromium DOM, native OS/GPU services mocked; NOT a WebScene/native rendering test',
        'passed':len(checks),'checks':checks,'pageErrors':errors}
(OUT/'shared-ui-smoke-report.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
if errors:raise SystemExit(1)
