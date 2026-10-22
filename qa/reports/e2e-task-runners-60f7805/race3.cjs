const TR=require('/workspace/n5audit-e2bb/lib/task-runners.js'),fs=require('fs'),cp=require('child_process');
const M='/tmp/n5race2/media';process.env.FFMPEG_BIN='/tmp/n5race2/bin/ff.sh';const N=+process.argv[2]||300;
const racer=cp.spawn('sh',['-c',`cd ${M}; mkdir -p real; echo INSIDE > real/a.wav; while :; do mv -T real keep; ln -s /tmp/n5race2/outdir real; rm real; mv -T keep real; done`]);
(async()=>{const r={ok:0,rej:0,inside:0,outside:0,other:{}};for(let i=0;i<N;i++){try{const x=await TR.renderSegment({audioPath:M+'/real/a.wav',durationSec:1,outPath:'/tmp/n5race2/o/'+i+'.mp4',mediaRoot:M});r.ok++;const c=fs.readFileSync(x.videoPath,'utf8').trim();if(c==='INSIDE')r.inside++;else if(c==='OUTSIDE')r.outside++;else r.other[c]=(r.other[c]||0)+1;r.sb=x.sandbox}catch(e){r.rej++;r.err=e.message.slice(0,60)}}
racer.kill();console.log(JSON.stringify(r));})();
