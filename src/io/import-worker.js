import {importFiles} from '../importers/formats.js';
self.onmessage=async e=>{try{const {files,name,scale}=e.data;const project=await importFiles(files,name,scale,p=>self.postMessage({type:'progress',...p}));self.postMessage({type:'complete',project});}catch(e){self.postMessage({type:'error',message:e.message,stack:e.stack});}};
