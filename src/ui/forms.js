/** Read this application's form fields without depending on the browser-only FormData constructor. */
export function formValues(form){
 const values=new Map();
 const add=(name,value)=>{if(!values.has(name))values.set(name,[]);values.get(name).push(value);};
 for(const field of form.querySelectorAll('input[name],select[name],textarea[name]')){
  const name=field.name||field.getAttribute('name'),type=(field.type||'').toLowerCase();
  if(!name||field.disabled||['submit','button','reset','file'].includes(type))continue;
  if(['radio','checkbox'].includes(type)&&!field.checked)continue;
  if(field.tagName.toLowerCase()==='select'&&field.multiple){for(const option of field.options||field.querySelectorAll('option'))if(option.selected&&!option.disabled)add(name,option.value);}
  else add(name,field.value??'');
 }
 return {get:name=>values.get(name)?.[0]??null,getAll:name=>values.get(name)||[],has:name=>values.has(name)};
}
/** Native runtimes may not implement the HTML top layer. The fallback uses the same dialog and CSS. */
export function showDialog(dialog){
 if(dialog.hasAttribute('open'))return;
 dialog.__restoreFocus=document.activeElement;
 let topLayer=false;
 if(typeof dialog.showModal==='function'){try{dialog.showModal();topLayer=dialog.hasAttribute('open');}catch{ /* Use the same DOM dialog when the runtime rejects the HTML top layer. */ }}
 if(!topLayer){
  dialog.setAttribute('data-modal-fallback','');dialog.setAttribute('open','');dialog.setAttribute('aria-modal','true');dialog.setAttribute('role','dialog');
  const backdrop=document.createElement('div');backdrop.className='dialog-backdrop';backdrop.setAttribute('aria-hidden','true');
  backdrop.onclick=()=>dialog.dispatchEvent(new Event('cancel',{cancelable:true}));
  dialog.parentNode.insertBefore(backdrop,dialog);dialog.__backdrop=backdrop;
 }
}
export function closeDialog(dialog){
 if(typeof dialog.close==='function'&&dialog.open)dialog.close();
 else dialog.removeAttribute('open');
 dialog.__backdrop?.remove();dialog.__backdrop=null;dialog.__restoreFocus?.focus?.();dialog.__restoreFocus=null;
}

/** Submit once from an explicit click/Enter; do not depend on implicit browser form actions. */
export function submitForm(form){
 if(typeof form.reportValidity==='function'&&form.reportValidity()===false)return false;
 return form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
}
export function trapDialogFocus(dialog,event){
 if(event.key!=='Tab'||!dialog.hasAttribute('data-modal-fallback'))return false;
 const controls=[...dialog.querySelectorAll('button,input,select,textarea,a[href],[tabindex]')].filter(el=>!el.disabled&&el.getAttribute('tabindex')!=='-1'&&!el.hidden&&(typeof el.getClientRects!=='function'||el.getClientRects().length));
 if(!controls.length){event.preventDefault();return true;}
 const first=controls[0],last=controls[controls.length-1],active=document.activeElement;
 if(event.shiftKey&&(active===first||!dialog.contains(active))){event.preventDefault();last.focus();return true;}
 if(!event.shiftKey&&(active===last||!dialog.contains(active))){event.preventDefault();first.focus();return true;}
 return false;
}
