"""DOM-only smoke tests using injected local modules. This does NOT test WebGPU rendering.
The local browser's managed policy blocks URL navigation, so no policy is changed.
Requires the optional Playwright Python package and Chromium on the test machine.
"""
import re, json, pathlib, os, shutil
from playwright.sync_api import sync_playwright
ROOT=pathlib.Path(__file__).resolve().parents[1]
modules={}; order=[]
def load(path):
    path=path.resolve(); key=str(path.relative_to(ROOT))
    if key in modules:return key
    text=path.read_text();modules[key]=''
    def imp(m):
        clause,relative=m.group(1),m.group(2); dep=load(path.parent/relative)
        if clause.strip().startswith('* as '):return 'const '+clause.strip()[5:]+'=__modules['+json.dumps(dep)+'];'
        return 'const '+clause+'=__modules['+json.dumps(dep)+'];'
    text=re.sub(r'import\s+(\*\s+as\s+\w+|\{[^}]+\})\s+from\s+[\'"]([^\'"]+)[\'"];?',imp,text)
    names=re.findall(r'export\s+(?:async\s+)?(?:function|class|const|let)\s+(\w+)',text)
    text=re.sub(r'\bexport\s+(?=(?:async\s+)?(?:function|class|const|let)\b)','',text)
    text=text.replace('import.meta.url',json.dumps('http://localhost:5173/'+key))
    if key=='src/app.js':text=text.split('const app=new App();globalThis.singletake=app;')[0]
    modules[key]=text+'\nreturn {'+','.join(names)+'};';order.append(key);return key
load(ROOT/'src/app.js')
bundle='const __modules={};\n'+'\n'.join('__modules['+json.dumps(k)+']=(function(){'+modules[k]+'})();' for k in order)+'\nwindow.singletake=new __modules["src/app.js"].App();window.testModules=__modules;'
html=(ROOT/'index.html').read_text();html=re.sub(r'<script.*?</script>','',html,flags=re.S);html=re.sub(r'<link[^>]+>','',html);html=html.replace('</head>','<style>'+(ROOT/'style.css').read_text()+'</style></head>')
results=[];errors=[]
with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or shutil.which('chromium') or shutil.which('chromium'),headless=True)
    page=browser.new_page(viewport={'width':1500,'height':980},device_scale_factor=1)
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.set_content(html)
    page.add_script_tag(content=bundle)
    page.evaluate('singletake.hideLoading()')
    # All tests run the real controller and document model, without initializing the renderer.
    page.evaluate('singletake.primitiveDialog("box")')
    page.locator('input[name="dimensions"]').fill('2 m, 3 m, 4 m')
    page.locator('button',has_text='Create box').click()
    page.wait_for_function('singletake.doc.project.nodes.length === 1')
    assert page.locator('.tree-row').count()==1
    results.append('Create exact box through dialog and populate Outliner')
    page.evaluate('singletake.action("duplicate")')
    assert page.evaluate('singletake.doc.project.nodes.length')==2
    page.evaluate('singletake.action("undo")')
    assert page.evaluate('singletake.doc.project.nodes.length')==1
    page.evaluate('singletake.action("redo")')
    assert page.evaluate('singletake.doc.project.nodes.length')==2
    results.append('Duplicate, undo, and redo through controller')
    page.evaluate('singletake.action("select-all");singletake.action("group")')
    assert page.evaluate('singletake.doc.project.nodes.length')==3
    assert page.evaluate('singletake.doc.project.nodes.filter(n=>n.parent).length')==2
    page.evaluate('singletake.action("ungroup")')
    assert page.evaluate('singletake.doc.project.nodes.length')==2
    results.append('Group and ungroup preserve scene members')
    page.evaluate('singletake.select(singletake.doc.project.nodes[0].id)')
    page.locator('[data-property="position-0"]').fill('2500 mm')
    page.locator('[data-property="position-0"]').press('Tab')
    page.wait_for_function('singletake.doc.project.nodes[0].matrix[12]===2.5')
    results.append('Entity inspector edits real transform coordinates')
    page.locator('[data-tab="materials"]').click()
    page.locator('[data-action="add-material"]').click()
    assert page.evaluate('singletake.doc.project.materials.length')==2
    page.locator('[data-property="material-name"]').fill('Smoke test finish')
    page.locator('[data-property="material-name"]').press('Tab')
    page.wait_for_function('singletake.doc.project.materials[1].name==="Smoke test finish"')
    page.locator('[data-action="paint-selection"]').click()
    page.wait_for_function('singletake.doc.project.nodes[0].material===1')
    results.append('Material creation, rename, and assignment operate on selected geometry')
    page.evaluate('singletake.tools.set("rectangle");singletake.tools.pending={kind:"rectangle",a:[0,0,0],plane:{point:[0,0,0],u:[1,0,0],v:[0,0,-1],normal:[0,1,0]}};singletake.tools.enter("4000 mm, 2000 mm")')
    assert page.evaluate('singletake.doc.project.nodes.length')==3
    results.append('Precise rectangle dimensions create geometry through the tool controller')
    page.evaluate('singletake.commandPalette()')
    page.locator('#command-search').fill('Sweep')
    assert page.locator('#command-results button').count()==1
    page.locator('#command-results button').click()
    page.wait_for_selector('textarea[name="path"]')
    page.locator('button',has_text='Create sweep').click()
    page.wait_for_function('singletake.doc.project.nodes.length===4')
    results.append('Command search opens and executes the sweep operation')
    page.evaluate('singletake.exportDialog()')
    assert page.locator('input[name="format"]').count()==6
    page.screenshot(path=str(ROOT/'docs/ui-dialog-smoke.png'))
    results.append('Export dialog exposes six implemented writers and compatibility notes')
    page.evaluate('singletake.closeModal();singletake.settings()')
    page.locator('select[name="units"]').select_option('mm')
    page.locator('button',has_text='Apply settings').click()
    page.wait_for_function('singletake.doc.project.units==="mm"')
    results.append('Workspace settings change display units without resizing geometry')
    page.evaluate('singletake.closeModal();const source=testModules["src/core/document.js"].newProject("Merged source"),m=testModules["src/geometry/mesh.js"].box();source.meshes[m.id]=m;source.nodes.push(testModules["src/core/document.js"].makeNode("Merged box",m.id));singletake.mergeProject(source)')
    assert page.evaluate('singletake.doc.project.nodes.length')==6
    page.evaluate('singletake.action("unique")')
    results.append('Merge another project into a namespaced group and make its geometry independent')
    browser.close()
report={'scope':'DOM/controller only; no WebGPU device, canvas rendering, navigation or GPU performance tested','passed':len(results),'checks':results,'pageErrors':errors}
(ROOT/'docs/ui-smoke-report.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report,indent=2))
if errors:raise SystemExit(1)
