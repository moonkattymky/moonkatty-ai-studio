import { spawn } from 'child_process'; import fs from 'fs';
const PORT=8822, UD='/tmp/mk-qa-af327b6b', B=`http://127.0.0.1:${PORT}`, PW='qa-pass-123'; fs.rmSync(UD,{recursive:true,force:true});
const srv=spawn(process.execPath,['server.js'],{cwd:'/workspace/mk',env:{...process.env,NODE_ENV:'test',STUDIO_FLAVOR:'test',STUDIO_DATA_DIR:UD,PORT:String(PORT),HOST:'127.0.0.1'},stdio:'ignore'});
for(let i=0;i<60;i++){try{if((await fetch(B+'/api/health')).ok)break}catch{} await new Promise(r=>setTimeout(r,300))}
const J={'content-type':'application/json','x-studio-request':'1'};
const r0=await fetch(B+'/api/auth/setup',{method:'POST',headers:J,body:JSON.stringify({username:'owner',password:PW})}); const cookie=r0.headers.get('set-cookie').split(';')[0];
const tok=fs.readFileSync(UD+'/app-token','utf8').trim(); const sess=cookie.split('=')[1];
const A={'x-studio-app-token':tok}, S={cookie};
const P=async(p,b,h)=>{const r=await fetch(B+p,{method:'POST',headers:{...J,...h},body:JSON.stringify(b)});let j;try{j=await r.json()}catch{j=null}return{s:r.status,j}};
const ap=(id,h,pw=PW)=>P('/api/world/approvals/'+id,{decision:'approve',password:pw},h);
const mk=async()=>(await P('/api/world/savings',{target_usd:Math.random()*1000|0},A)).j.approvalId;
const out=[];
const id1=await mk(); out.push('Bearer alone: '+(await ap(id1,{authorization:'Bearer '+sess})).s+' '+JSON.stringify((await ap(id1,{authorization:'Bearer '+sess})).j).slice(0,120));
const id2=await mk(); const r2=await ap(id2,{authorization:'Bearer '+sess}); out.push('Bearer alone fresh: '+r2.s+' '+JSON.stringify(r2.j).slice(0,160));
const id3=await mk(); const r3=await ap(id3,{authorization:'Bearer '+sess,'x-studio-app-token':'junk'}); out.push('Bearer+junk: '+r3.s+' '+JSON.stringify(r3.j).slice(0,160));
const id4=await mk(); const r4=await ap(id4,{'X-Studio-App-Token':tok,cookie}); out.push('case+cookie: '+r4.s+' '+JSON.stringify(r4.j).slice(0,160));
const id5=await mk(); const r5=await ap(id5,{'x-studio-app-token':'   ',cookie}); out.push('whitespace tok+cookie: '+r5.s+' '+JSON.stringify(r5.j).slice(0,160));
const id6=await mk(); const r6=await ap(id6,{'x-studio-app-token':'0',cookie}); out.push('tok=0 +cookie: '+r6.s+' '+JSON.stringify(r6.j).slice(0,160));
// self-approval same channel
const own=await P('/api/world/savings',{target_usd:9},S); out.push('self-approve session: '+(await ap(own.j.approvalId,S)).s+' '+JSON.stringify((await ap(own.j.approvalId,S)).j).slice(0,100));
// create as Bearer (session), approve as cookie (same channel session) = self
const ownB=await P('/api/world/savings',{target_usd:8},{authorization:'Bearer '+sess}); const rB=await ap(ownB.j.approvalId,S); out.push('Bearer-create then cookie-approve: '+rB.s+' '+JSON.stringify(rB.j).slice(0,140));
console.log(out.join('\n')); srv.kill();
