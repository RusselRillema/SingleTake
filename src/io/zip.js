const decoder=new TextDecoder();
let nativeInflater=null;
/** Native hosts supply bounded raw DEFLATE without emulating a browser stream stack. */
export function setNativeInflater(inflate){if(inflate!==null&&typeof inflate!=='function')throw Error('Inflater must be a function or null.');nativeInflater=inflate;}
const CRC_TABLE=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
export function crc32(bytes){let c=0xffffffff;for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;}
/** Reads ordinary and prepended-header ZIP archives. ZIP64 and encrypted entries fail explicitly. */
export async function unzip(input,{maxBytes=512*1024*1024,maxEntries=20000,onProgress=()=>{}}={}){
 const bytes=input instanceof Uint8Array?input:new Uint8Array(input),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
 let eocd=-1;for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65558);p--)if(v.getUint32(p,true)===0x06054b50){eocd=p;break;}
 if(eocd<0)throw Error('This file does not contain a supported ZIP directory.');
 const count=v.getUint16(eocd+10,true),size=v.getUint32(eocd+12,true),offset=v.getUint32(eocd+16,true);
 if(count===65535||size===0xffffffff||offset===0xffffffff)throw Error('ZIP64 archives are not supported by this build.');
 if(count>maxEntries)throw Error(`Archive exceeds ${maxEntries} entries.`);
 const base=eocd-size-offset,files=new Map();let p=eocd-size,total=0;
 for(let i=0;i<count;i++){
  if(p<0||p+46>bytes.length||v.getUint32(p,true)!==0x02014b50)throw Error('Invalid ZIP central directory.');
  const flags=v.getUint16(p+8,true),method=v.getUint16(p+10,true),crc=v.getUint32(p+16,true),packed=v.getUint32(p+20,true),raw=v.getUint32(p+24,true),nameLen=v.getUint16(p+28,true),extra=v.getUint16(p+30,true),comment=v.getUint16(p+32,true),local=v.getUint32(p+42,true)+base;
  const name=decoder.decode(bytes.subarray(p+46,p+46+nameLen));p+=46+nameLen+extra+comment;
  if(flags&1)throw Error('Encrypted ZIP entries are not supported.');
  if(raw===0xffffffff||packed===0xffffffff)throw Error('ZIP64 entry unsupported.');
  total+=raw;if(total>maxBytes)throw Error('Expanded archive exceeds the 512 MB safety limit.');
  if(local<0||local+30>bytes.length||v.getUint32(local,true)!==0x04034b50)throw Error(`Invalid ZIP entry: ${name}`);
  const begin=local+30+v.getUint16(local+26,true)+v.getUint16(local+28,true);
  if(begin+packed>bytes.length)throw Error('Truncated ZIP payload.');
  const compressed=bytes.subarray(begin,begin+packed);let data;
  if(method===0)data=compressed.slice();
  else if(method===8&&nativeInflater){
   data=await nativeInflater(compressed,raw);
   if(!(data instanceof Uint8Array)||data.length!==raw||data.length>maxBytes)throw Error('Native inflation returned an invalid size.');
  }
  else if(method===8){
   const stream=new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
   // Bound the actual decompressed bytes too, not only untrusted ZIP metadata.
   const reader=stream.getReader(),chunks=[];let length=0;
   for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>raw||length>maxBytes){await reader.cancel();throw Error('Decompression exceeds declared size.');}chunks.push(value);}
   data=new Uint8Array(length);let at=0;for(const c of chunks){data.set(c,at);at+=c.length;}
  }else throw Error(`ZIP compression method ${method} is unsupported.`);
  if(data.length!==raw||crc32(data)!==crc)throw Error(`ZIP checksum failed: ${name}`);
  files.set(name,data);onProgress((i+1)/count);
 }
 return files;
}
/** Deterministic uncompressed ZIP writer (for OBJ + MTL + textures bundles). */
export function zip(files){
 const enc=new TextEncoder(),chunks=[],central=[];let offset=0;
 for(const [name,content] of files){const bytes=typeof content==='string'?enc.encode(content):content,n=enc.encode(name),crc=crc32(bytes);const local=new Uint8Array(30+n.length),v=new DataView(local.buffer);v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x800,true);v.setUint32(14,crc,true);v.setUint32(18,bytes.length,true);v.setUint32(22,bytes.length,true);v.setUint16(26,n.length,true);local.set(n,30);chunks.push(local,bytes);
  const dir=new Uint8Array(46+n.length),d=new DataView(dir.buffer);d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x800,true);d.setUint32(16,crc,true);d.setUint32(20,bytes.length,true);d.setUint32(24,bytes.length,true);d.setUint16(28,n.length,true);d.setUint32(42,offset,true);dir.set(n,46);central.push(dir);offset+=local.length+bytes.length;
 }
 const size=central.reduce((s,c)=>s+c.length,0),end=new Uint8Array(22),v=new DataView(end.buffer);v.setUint32(0,0x06054b50,true);v.setUint16(8,central.length,true);v.setUint16(10,central.length,true);v.setUint32(12,size,true);v.setUint32(16,offset,true);return new Blob([...chunks,...central,end],{type:'application/zip'});
}
