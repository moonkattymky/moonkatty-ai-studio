import { spawn } from 'child_process'; import fs from 'fs';
const PORT=8812, UD='/tmp/mk-qa-e2e001-r2', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123'; fs.rmSync(UD,{recursive:true,force:true});
const srv=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1'},stdio:['ignore','pipe','pipe']});
let slog='';srv.stdout.on('data',d=>slog+=d);srv.stderr.on('data',d=>slog+=d);
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const cookie=r0.headers.get('set-cookie').split(';')[0];
const tok=fs.readFileSync(UD+'/app-token','utf8').trim();
const S={cookie}, A={'x-studio-app-token':tok}, AF={'x-studio-app-token':tok,cookie:'mk_session=deadbeef'}, SB={authorization:'Bearer '+cookie.split('=')[1],'x-studio-app-token':'junk'};
const P=async(p,b,h)=>{const r=await fetch(B+p,{method:'POST',headers:{...J,...h},body:JSON.stringify(b)});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j}};
const G=async p=>(await fetch(B+p,{headers:S})).json();
const out=[];const L=(n,x)=>out.push(n+' => '+x.s+' '+JSON.stringify(x.j).slice(0,200));
const ap=(id,h,pw=PW)=>P('/api/world/approvals/'+id,{decision:'approve',password:pw},h);
const sav=()=>G('/api/world/savings').catch(()=>null);
const dbq=sql=>{const {DatabaseSync}=require('node:sqlite');};
// matrix
L('M1 savings no confirm (session)',await P('/api/world/savings',{target_usd:100},S));
L('M2 savings confirm:true',await P('/api/world/savings',{target_usd:200,confirm:true},S));
L('M3 paid_ads confirm',await P('/api/world/action',{action:'paid_ads',confirm:true},S));
const cs=await P('/api/world/action',{action:'critical_settings',confirm:true},S); L('M4 critical_settings confirm',cs);
L('M5 fake_views confirm',await P('/api/world/action',{action:'fake_views',confirm:true},S));
L('M6 pending id',await P('/api/world/action',{action:'critical_settings',approvalId:cs.j.approvalId},S));
for(const t of [[cs.j.approvalId],{id:cs.j.approvalId},123,true,"' OR 1=1 --"]) L('M7 type '+JSON.stringify(t),await P('/api/world/action',{action:'critical_settings',approvalId:t},S));
// R2: self-approval / app-token / password
const a1=await P('/api/world/savings',{target_usd:300},A); L('R2 app creates savings 300',a1);
L('R2 app approves (correct pw)',await ap(a1.j.approvalId,A));
L('R2 session wrong pw',await ap(a1.j.approvalId,S,'wrong-pass'));
L('R2 session no pw',await P('/api/world/approvals/'+a1.j.approvalId,{decision:'approve'},S));
const s1=await P('/api/world/savings',{target_usd:301},S); L('R2 session self-approve own session request',await ap(s1.j.approvalId,S));
// brute force
const bf=[];for(let i=0;i<30;i++)bf.push((await ap(a1.j.approvalId,S,'bad'+i)).s);
out.push('BF 30 wrong pw statuses: '+JSON.stringify(bf.reduce((a,s)=>(a[s]=(a[s]||0)+1,a),{})));
L('BF correct pw after 30 failures (session approves app request)',await ap(a1.j.approvalId,S));
out.push('savings now: '+JSON.stringify(await sav()));
// R1: reuse after approve-exec
L('R1 reuse id via /savings 999999',await P('/api/world/savings',{target_usd:999999,approvalId:a1.j.approvalId},A));
L('R1 reuse id via /savings 300 same params',await P('/api/world/savings',{target_usd:300,approvalId:a1.j.approvalId},A));
L('R1 re-approve',await ap(a1.j.approvalId,S));
// R3: param binding, pending overwrite
const b1=await P('/api/world/savings',{target_usd:10},A); await P('/api/world/savings',{target_usd:777777},A);
L('R3 approve id for 10',await ap(b1.j.approvalId,S)); out.push('R3 savings after: '+JSON.stringify(await sav()));
// NEW: app token spoofed as session via fake cookie
const c1=await P('/api/world/savings',{target_usd:400},S);
L('N1 app token + fake mk_session cookie approves session request',await ap(c1.j.approvalId,AF));
const c2=await P('/api/world/savings',{target_usd:401},AF); L('N1b app+fakecookie creates request (principal?)',c2);
L('N1c app+fakecookie approves its own fakecookie request',await ap(c2.j.approvalId,AF));
// spoof requester: session via Bearer + junk app header → labelled @app; then approve by cookie session = self-approval
const d1=await P('/api/world/savings',{target_usd:500},SB); L('N2 session(Bearer)+junk app header creates',d1);
L('N2 same owner cookie-session approves own request',await ap(d1.j.approvalId,S));
// body spoof of requested_by/user
const e1=await P('/api/world/savings',{target_usd:600,requested_by:'other@session',user:'x',actor:'y'},S);
L('N3 body requested_by spoof then session approve',await ap(e1.j.approvalId,S));
out.push('approval rows: '+JSON.stringify((await G('/api/world/approvals')).slice?.(0,12).map(r=>[r.id?.slice(-4),r.status,r.requested_by||r.requestedBy,r.decided_by||r.decidedBy,r.consumed_at?1:0,r.exec_status||r.execStatus])));
const j=await G('/api/world/journal'); out.push('journal has password? '+JSON.stringify(j).includes(PW)+' / logs? '+slog.includes(PW));
fs.writeFileSync('/tmp/r2-journal.json',JSON.stringify(j));
console.log(out.join('\n')); srv.kill();
await new Promise(r=>setTimeout(r,500));
const all=fs.readdirSync(UD,{recursive:true}).filter(f=>!/\.(db|db-wal|db-shm)$/.test(f)); let hit=false;
for(const f of all){try{const st=fs.statSync(UD+'/'+f); if(st.isFile()&&fs.readFileSync(UD+'/'+f,'utf8').includes(PW))hit=f}catch{}}
const {DatabaseSync}=await import('node:sqlite'); const d=new DatabaseSync(UD+'/studio.db');
const dbdump=JSON.stringify(d.prepare("select * from world_approvals").all())+JSON.stringify(d.prepare("select * from meta").all());
console.log('password in data files: '+hit+' / in db tables approvals+meta: '+dbdump.includes(PW));
console.log('expired legacy test via db: rows='+d.prepare('select count(*) c from world_approvals').get().c);
