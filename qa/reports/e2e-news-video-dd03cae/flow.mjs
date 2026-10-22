const B=process.env.B; const H={'content-type':'application/json','x-studio-request':'1'};
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:H,body:JSON.stringify({username:'qa',password:'qa-pass-12345'})});
const ck=lr.headers.getSetCookie().map(c=>c.split(';')[0]).join('; '); const A={...H,cookie:ck};
const j=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:A,body:b?JSON.stringify(b):undefined});let t=await r.text();try{t=JSON.parse(t)}catch{};return [r.status,t]};
const L=(...a)=>console.log(...a);
L('ollama',(await j('PUT','/api/integrations/ollama',{model:'qwen2.5:1.5b'}))[0]);
let [s,sr]=await j('POST','/api/newsvideo/search'); L('search',s,JSON.stringify({...sr.run,errors:sr.run.errors?.length}).slice(0,300),'cands',sr.candidates.length);
const c=sr.candidates.filter(x=>x.credibility?.status!=='disputed').slice(0,2).map(x=>x.id);
const t0=Date.now(); let [ds,d]=await j('POST','/api/newsvideo/drafts',{storyIds:c}); L('draft',ds,d.id,d.stories?.map(x=>x.provider+'|'+x.fallbackReason),((Date.now()-t0)/1000)+'s');
// factcheck links
const allow=new Set(sr.candidates.flatMap(x=>(x.sources||[]).map(y=>y.url)));
const st=(await j('GET','/api/newsvideo/status'))[1]; const hosts=new Set(st.sources.map(x=>new URL(x.url).hostname));
let links=0,bad=[];for(const x of d.stories)for(const se of x.factCheck.sentences)for(const l of se.sources){links++;try{const u=new URL(l.url);if(u.protocol!=='https:'||!(hosts.has(u.hostname)||[...hosts].some(h=>u.hostname.endsWith(h.split('.').slice(-2).join('.')))))bad.push(l.url)}catch{bad.push(l.url)}}
L('fc sentences',d.stories.map(x=>x.factCheck.sentences.length),'flagged',d.stories.map(x=>x.factCheck.flagged),'links',links,'badlinks',bad.slice(0,5),'hasSourceItems',JSON.stringify(d).includes('sourceItems'));
L('fc example',JSON.stringify(d.stories[0].factCheck.sentences[0]).slice(0,400));
L('approve no box',(await j('POST',`/api/newsvideo/drafts/${d.id}/approve`,{contentHash:d.contentHash}))[0]);
L('approve box=\"true\"',(await j('POST',`/api/newsvideo/drafts/${d.id}/approve`,{factChecked:'true',contentHash:d.contentHash}))[0]);
L('approve wrong hash',(await j('POST',`/api/newsvideo/drafts/${d.id}/approve`,{factChecked:true,contentHash:'x'}))[0]);
L('approve confirm:true',(await j('POST',`/api/newsvideo/drafts/${d.id}/approve`,{confirm:true}))[0]);
L('render before approve',(await j('POST',`/api/newsvideo/drafts/${d.id}/render`,{preset:'youtube'}))[0]);
let [as]=await j('POST',`/api/newsvideo/drafts/${d.id}/approve`,{factChecked:true,contentHash:d.contentHash}); L('approve ok',as);
let [rs,rd]=await j('POST',`/api/newsvideo/drafts/${d.id}/render`,{preset:'youtube'}); L('render',rs,rd.status);
L('edit during render',(await j('PUT',`/api/newsvideo/drafts/${d.id}`,{title:'X'}))[0]);
let g; for(let i=0;i<120;i++){await new Promise(r=>setTimeout(r,3000)); g=(await j('GET',`/api/newsvideo/drafts/${d.id}`))[1]; if(g.status!=='rendering')break;} L('final',g.status,'renders',g.renders.map(r=>r.status+':'+(r.error||'')));
for(const k of ['mp4','srt','jpg']){const r=await fetch(B+`/api/newsvideo/drafts/${d.id}/file?kind=${k}&download=1`,{headers:A});const buf=Buffer.from(await r.arrayBuffer());(await import('fs')).writeFileSync(process.env.OUT+'/flow.'+k,buf);L('export',k,r.status,buf.length,r.headers.get('content-disposition'))}
// NV-002
const [es,e]=await j('PUT',`/api/newsvideo/drafts/${d.id}`,{stories:g.stories.map(x=>({id:x.id,text:x.text+' Edited.'}))}); L('edit after render',es,e.status,'stale',e.staleRender);
await new Promise(r=>setTimeout(r,500)); const g2=(await j('GET',`/api/newsvideo/drafts/${d.id}`))[1]; const lst=(await j('GET','/api/newsvideo/drafts'))[1].find(x=>x.id===d.id);
L('after edit GET',g2.status,'list',lst.status,'checked',g2.factCheck.checked);
L('rerender w/o reapprove',(await j('POST',`/api/newsvideo/drafts/${d.id}/render`,{preset:'youtube'})));
L('file still served (old render)',(await fetch(B+`/api/newsvideo/drafts/${d.id}/file?kind=mp4`,{headers:A})).status);
L('cancel idle',JSON.stringify((await j('POST','/api/newsvideo/drafts/cancel'))[1]));
const p=j('POST','/api/newsvideo/drafts',{storyIds:c}); await new Promise(r=>setTimeout(r,300));
L('parallel create',(await j('POST','/api/newsvideo/drafts',{storyIds:c}))[0]); L('cancel',JSON.stringify((await j('POST','/api/newsvideo/drafts/cancel'))[1])); const pr=await p; L('cancelled create',pr[0],String(pr[1].error).slice(0,100));
L('7 ids',(await j('POST','/api/newsvideo/drafts',{storyIds:[1,2,3,4,5,6,7]}))[0]);
console.log('DRAFT',d.id);
