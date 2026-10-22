#!/bin/sh
D=/tmp/mk-test-nv5; mkdir -p $D/data $D/bin; ln -sf /home/box/node22/bin/node $D/bin/node; echo qa-nv5-$(date +%s%N) > $D/pw
PATH=$D/bin STUDIO_ADMIN_PASSWORD=$(/bin/cat $D/pw) STUDIO_DATA_DIR=$D/data PORT=18993 HOST=127.0.0.1 NODE_ENV=production $D/bin/node -r /workspace/qa133/rssmock.cjs /workspace/qa133/res/app.asar.unpacked/server.js > $D/srv.log 2>&1 &
SP=$!; for i in $(seq 60); do /usr/bin/curl -sf http://127.0.0.1:18993/api/health >/dev/null && break; sleep 0.5; done
PWF=$D/pw /home/box/node22/bin/node /workspace/qa133/nv5live.mjs; kill $SP; grep -i "ffmpeg\|ENOENT" $D/srv.log | head -3
