// Creates a synthetic shared-JS packet for the independent C# protocol test executable.
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {Document,projectBounds} from '../src/core/document.js';
import {box} from '../src/geometry/mesh.js';
import {SceneProxy} from '../desktop/shared/scene-proxy.js';
const doc=new Document();doc.addMesh(box(2,3,4));
const proxy=new SceneProxy();
proxy.resize(1000,800);proxy.setProject(doc.project);proxy.camera.fit(projectBounds(doc.project));
const file=resolve(process.argv[2]||'artifacts/protocol-scene.json');
await mkdir(dirname(file),{recursive:true});await writeFile(file,JSON.stringify(proxy.packet([]))+'\n');
console.log(file);
