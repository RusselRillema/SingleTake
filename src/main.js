import {App} from './app.js';
import {createBrowserPlatform} from './platform/browser.js';
const app=new App(createBrowserPlatform());
globalThis.singletake=app;
app.init().catch(error=>{console.error(error);app.hideLoading();app.toast(error.message,'error');});
