import { spawn } from 'child_process'; import fs from 'fs'; import http from 'http';
const PORT=8821, UD='/tmp/mk-qa-af327b6', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123'; fs.rmSync(UD,{recursive:true,force:true});
const srv=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1',STUDIO_ADMIN_PASSWORD:'',STUDIO_SECRET_KEY:'secret-for-leak-test-xyz'},stdio:['ignore','pipe','pipe']});
let slog='';srv.stdout.on('data',d=>slog+=d);srv.stderr.on('data',d=>slog+=d);
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const cookie=r0.headers.get('set-cookie').split(';')[0];
const tok=fs.readFileSync(UD+'/app-token','utf8').trim();
const S={cookie}, A={'x-studio-app-token':tok};
const P=async(p,b,h)=>{const r=await fetch(B+p,{method:'POST',headers:{...J,...h},body:JSON.stringify(b)});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j}};
const ap=(id,h,pw=PW)=>P('/api/world/approvals/'+id,{decision:'approve',password:pw},h);
const out=[]; const L=(n,x)=>out.push(n+' => '+x.s+' '+JSON.stringify(x.j).slice(0,180));
// matrix
L('M1 savings no confirm',await P('/api/world/savings',{target_usd:100},S));
L('M2 savings confirm:true',await P('/api/world/savings',{target_usd:200,confirm:true},S));
L('M3 paid_ads confirm',await P('/api/world/action',{action:'paid_ads',confirm:true},S));
L('M4 critical_settings confirm',await P('/api/world/action',{action:'critical_settings',confirm:true},S));
L('M5 fake_views confirm',await P('/api/world/action',{action:'fake_views',confirm:true},S));
// N1 variants
const a1=await P('/api/world/savings',{target_usd:300},A); L('N1 app creates',a1);
L('N1a pure app approve',await ap(a1.j.approvalId,A));
L('N1b app + fake cookie',await ap(a1.j.approvalId,{...A,cookie:'mk_session=deadbeef'}));
L('N1c app + REAL cookie',await ap(a1.j.approvalId,{...A,cookie}));
L('N1d empty token header',await ap(a1.j.approvalId,{'x-studio-app-token':'',...S}));
L('N1e case variant X-Studio-App-Token',await ap(a1.j.approvalId,{'X-Studio-App-Token':tok,...S})); // node lowercases
L('N1f Bearer session alone',await ap(a1.j.approvalId,{authorization:'Bearer '+cookie.split('=')[1]}));
L('N1g Bearer + junk app token',await ap(a1.j.approvalId,{authorization:'Bearer '+cookie.split('=')[1],'x-studio-app-token':'junk'}));
L('N1h session approve app request (happy path)',await ap(a1.j.approvalId,S));
// N2 lockout
const a2=await P('/api/world/savings',{target_usd:301},A);
const bf=[]; for(let i=0;i<6;i++) bf.push((await ap(a2.j.approvalId,S,'bad'+i)).s);
out.push('N2 6 wrong: '+JSON.stringify(bf));
L('N2 7th correct while locked',await ap(a2.j.approvalId,S));
// wrong pw on unverified / app channel — should not count
srv.kill(); await new Promise(r=>setTimeout(r,800));
const srv2=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1'},stdio:'ignore'});
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
const lr=await fetch(B+'/api/auth/login',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const c2={cookie:lr.headers.get('set-cookie').split(';')[0]};
const a3=await P('/api/world/savings',{target_usd:302},A); L('N2 after restart creates',a3);
// 20 wrong via APP channel (should not lock)
const appFails=[]; for(let i=0;i<20;i++) appFails.push((await ap(a3.j.approvalId,A,'bad'+i)).s);
out.push('N2 20 wrong via app channel: '+JSON.stringify(appFails.reduce((a,s)=>(a[s]=(a[s]||0)+1,a),{})));
L('N2 session approve after 20 app fails',await ap(a3.j.approvalId,c2));
// DoS: lock via session from attacker with session? only owner has password; but wrong session of owner locks them. Can agent with stolen session lock?
const a4=await P('/api/world/savings',{target_usd:303},A);
const lock=[]; for(let i=0;i<5;i++) lock.push((await ap(a4.j.approvalId,c2,'x')).s);
out.push('N2 5 wrong to lock: '+JSON.stringify(lock));
L('N2 correct after lock (DoS)',await ap(a4.j.approvalId,c2));
// empty token vs missing: empty is still "hasTok"
L('N1 empty tok + session (create then)',await P('/api/world/savings',{target_usd:1},{'x-studio-app-token':'',...c2}));
console.log(out.join('\n')); srv2.kill();
