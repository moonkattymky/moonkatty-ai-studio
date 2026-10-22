const B='http://127.0.0.1:8696'; const { chromium } = await import('/workspace/qa131/node_modules/playwright-core/index.mjs');
let pass=0,fail=0; const t=(n,c,x='')=>{c?pass++:fail++;console.log((c?'PASS ':'FAIL ')+n+(x?' — '+String(x).slice(0,160):''))};
const br=await chromium.launch({executablePath:'/usr/bin/google-chrome',args:['--no-sandbox']}); const p=await br.newPage(); const errs=[]; p.on('pageerror',e=>errs.push(e.message));
const net=[]; p.on('response',async r=>{if(/world\/(savings|approvals)/.test(r.url())&&r.request().method()==='POST'){let j={};try{j=await r.json()}catch{} net.push([r.url().split('/api/')[1],r.status(),j.code||j.status,r.request().postDataJSON()])}});
await p.goto(B+'/'); await p.fill('#auth input[name=username]','igor'); await p.fill('#auth input[name=password]','qa-pass-12345'); await p.click('#auth button'); await p.waitForSelector('#app:not(.hidden)');
const toast=async()=>{await p.waitForTimeout(600);return (await p.locator('#toast div').last().textContent().catch(()=>''))||''};
await p.evaluate(()=>location.hash='revenue'); await p.waitForSelector('#savForm',{timeout:20000});
await p.fill('#savForm input[name=target]','777'); await p.click('#savForm button'); let tx=await toast();
const n0=net.at(-1); t('real savings → 403 needs_owner + approvalId',n0&&n0[1]===403&&n0[2]==='needs_owner',JSON.stringify(n0)); t('UI text needs_owner',/Нужно подтверждение владельца/.test(tx),tx); t('no confirm in body',n0&&!('confirm' in n0[3]));
const id=(tx.match(/№ ([\w-]+)/)||[])[1]; await p.waitForTimeout(800);
await p.evaluate(()=>{location.hash='news'}); await p.waitForTimeout(500); await p.evaluate(()=>{location.hash='revenue'}); 
const sel=`[data-dec="approve"]`; await p.waitForSelector(sel,{timeout:20000}); t('approval visible in Очередь владельца',await p.locator(sel).count()>0);
await p.locator(sel).first().click(); await p.fill('#modal input[name=password]','wrong-pass'); await p.click('#modal .btn.primary'); tx=await toast(); const n1=net.at(-1);
t('wrong password → 403 owner_reauth, UI text',n1[1]===403&&n1[2]==='owner_reauth'&&/Неверный пароль/.test(tx),tx);
await p.waitForTimeout(6000);
await p.waitForSelector(sel); await p.locator(sel).first().click(); await p.fill('#modal input[name=password]','qa-pass-12345'); await p.click('#modal .btn.primary'); tx=await toast(); const n2=net.at(-1);
t('correct password → 200 approved (owner step-up)',n2[1]===200,JSON.stringify(n2.slice(0,3))+' '+tx); t('password field cleared',(await p.locator('#modal input[name=password]').count())===0||(await p.inputValue('#modal input[name=password]'))==='');
await p.waitForSelector('#savForm'); await p.fill('#savForm input[name=target]','777'); await p.click('#savForm button'); tx=await toast(); const n3=net.at(-1);
t('retry with approvalId → 200, saved',n3[1]===200&&n3[3].approvalId,JSON.stringify(n3)+' '+tx);
// replay consumed via API from page session
const rep=await p.evaluate(async([id])=>{const r=await fetch('/api/world/savings',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({target_usd:777,approvalId:id})});return [r.status,await r.json()]},[n3[3].approvalId]); t('replay consumed approvalId → 409 consumed',rep[0]===409&&rep[1].code==='consumed',JSON.stringify(rep));
const cf=await p.evaluate(async()=>{const r=await fetch('/api/world/savings',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({target_usd:1,confirm:true})});return [r.status,await r.json()]}); t('confirm:true bypass → 403 needs_owner',cf[0]===403&&cf[1].code==='needs_owner',JSON.stringify(cf).slice(0,120));
// params mismatch: request for 5, approve, then use for 6
const a=await p.evaluate(async()=>{const r=await fetch('/api/world/savings',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({target_usd:5})});return (await r.json()).approvalId});
const ap=await p.evaluate(async([a])=>(await fetch('/api/world/approvals/'+a,{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({decision:'approve',password:'qa-pass-12345'})})).status,[a]);
const mm=await p.evaluate(async([a])=>{const r=await fetch('/api/world/savings',{method:'POST',headers:{'content-type':'application/json','x-studio-request':'1'},body:JSON.stringify({target_usd:6,approvalId:a})});return [r.status,await r.json()]},[a]); t('params-bound: approved for 5, used for 6 → rejected',mm[0]>=400,JSON.stringify(mm).slice(0,160)+' approve='+ap);
t('no JS errors',errs.length===0,errs.join('|')); await p.screenshot({path:'/workspace/out/qa-dd/real-appr.png'}); await br.close(); console.log(`${pass} passed, ${fail} failed`);
