import fs from 'fs'; const B='http://127.0.0.1:18993', PW=fs.readFileSync(process.env.PWF,'utf8').trim();
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({username:'igor',password:PW})}); const ck=(lr.headers.get('set-cookie')||'').split(';')[0];
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'content-type':'application/json','x-studio-request':'1',origin:B,cookie:ck},body:b?JSON.stringify(b):undefined});return {s:r.status,j:await r.json().catch(()=>null)}};
console.log('login',lr.status); const st=await call('GET','/api/newsvideo/status'); console.log('status',st.s,JSON.stringify(st.j?.videoDeps));
const s=await call('POST','/api/newsvideo/search'); const c=s.j.candidates[0]; let d=(await call('POST','/api/newsvideo/drafts',{storyIds:[c.id]})).j; console.log('draft',d.id,d.status);
const cur=(await call('GET',`/api/newsvideo/drafts/${d.id}`)).j; const a=await call('POST',`/api/newsvideo/drafts/${d.id}/approve`,{factChecked:true,contentHash:cur.contentHash}); console.log('APPROVE',a.s,JSON.stringify(a.j).slice(0,300));
const r=await call('POST',`/api/newsvideo/drafts/${d.id}/render`,{preset:'youtube'}); console.log('RENDER',r.s,JSON.stringify(r.j).slice(0,300));
