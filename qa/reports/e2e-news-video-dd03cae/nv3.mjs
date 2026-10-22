const B=process.env.B; const H={'content-type':'application/json','x-studio-request':'1'};
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:H,body:JSON.stringify({username:'qa',password:'qa-pass-12345'})});
const A={...H,cookie:lr.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ')};
const j=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:A,body:b?JSON.stringify(b):undefined});return [r.status,await r.json()]};
const ps=async()=>(await (await fetch('http://127.0.0.1:11434/api/ps')).json()).models.map(m=>m.name);
const c=(await j('GET','/api/newsvideo/stories'))[1].candidates.filter(x=>x.credibility?.status!=='disputed').slice(3,4).map(x=>x.id);
const [,d]=await j('POST','/api/newsvideo/drafts',{storyIds:c}); console.log('provider',d.stories.map(s=>s.provider),'ps before approve',await ps());
console.log('approve',(await j('POST',`/api/newsvideo/drafts/${d.id}/approve`,{factChecked:true,contentHash:d.contentHash}))[0]);
console.log('render',(await j('POST',`/api/newsvideo/drafts/${d.id}/render`,{preset:'shorts'}))[0]);
let g;for(let i=0;i<100;i++){await new Promise(r=>setTimeout(r,2000));g=(await j('GET',`/api/newsvideo/drafts/${d.id}`))[1];if(i==3)console.log('ps during render',await ps());if(g.status!=='rendering')break}
console.log('final',g.status,'ps after',await ps());
