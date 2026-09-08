import './primitives.js';
import {App} from '../../src/app.js';
import {createNativePlatform} from './native-platform.js';
import {uiBody,uiCss,sourceHashes} from 'singletake:ui';
let app=null,style=null;

/** Full-window canonical UI, not a replacement panel or an alternate command implementation. */
globalThis.mount=async()=>{
 if(app)await globalThis.unmount();
 if(!globalThis.webscene?.host?.commands?.invoke)throw Error('The native command capability is unavailable.');
 document.body.innerHTML=uiBody;
 style=document.createElement('style');style.id='singletake-shared-styles';style.textContent=uiCss;document.head.appendChild(style);
 document.documentElement.setAttribute('data-native-viewport','');
 const invoke=(method,args)=>webscene.host.commands.invoke(method,args),platform=createNativePlatform(invoke);
 app=new App(platform);globalThis.singletake=app;
 globalThis.SingleTakeDesktop={
  isDirty:()=>!!app?.doc.dirty,
  presented:e=>app?.renderer.presented(e),
  reset:()=>app?.renderer.resetResources(),
  blurred:()=>{app?.tools.releaseModifiers();},
  diagnostics:()=>({ui:'shared',controller:'src/app.js',sources:sourceHashes,objects:app?.doc.project.nodes.length||0,canvas:app?.renderer.rectangle,renderer:'native-opengl',browser:false}),
  // Acceptance uses the same visible dialog, form submission and controller as the user.
  startSmoke:async()=>{
   await app.action('box');const form=document.querySelector('#primitive-form');if(!form)throw Error('Shared primitive dialog was not created.');
   form.querySelector('[name="dimensions"]').value='2 m, 2 m, 2 m';
   form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
   await new Promise(resolve=>setTimeout(resolve,0));
   if(!app.doc.project.nodes.length)throw Error('The shared form did not create geometry.');
   app.closeModal();app.doc.transaction('Acceptance title',p=>p.name='Native acceptance');app.fit();return true;
  }
 };
 await app.init();
 if(!app.ready)throw Error('The shared application could not initialize the native viewport.');
 const canonical=['.topbar','.commandbar','.tool-rail','.inspector','.statusbar','#measurement-input','#outliner','#canvas'];
 for(const selector of canonical)if(!document.querySelector(selector))throw Error('Missing shared UI: '+selector);
 await invoke('ready',{ui:'shared',sources:sourceHashes});
 app.canvas.focus();
};
globalThis.unmount=async()=>{
 const old=app;app=null;if(old)await old.dispose();
 if(globalThis.singletake===old)delete globalThis.singletake;
 delete globalThis.SingleTakeDesktop;style?.remove();style=null;
 document.documentElement.removeAttribute('data-native-viewport');document.body.innerHTML='';
};
