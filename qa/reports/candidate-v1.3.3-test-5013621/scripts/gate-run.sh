#!/bin/sh
export PATH=/home/box/node22/bin:$PATH
D=/tmp/mk-test-gate; mkdir -p $D/data; echo qa-gate-$(date +%s%N) > $D/pw
STUDIO_ADMIN_PASSWORD=$(cat $D/pw) STUDIO_DATA_DIR=$D/data PORT=18991 HOST=127.0.0.1 NODE_ENV=production node /workspace/qa133/res/app.asar.unpacked/server.js > $D/srv.log 2>&1 &
SP=$!; for i in $(seq 60); do curl -sf http://127.0.0.1:18991/api/health >/dev/null && break; sleep 0.5; done
ls $D/data; SRVDIR=$D node /workspace/qa133/gate.mjs; echo GATE_EXIT=$?
kill $SP; tail -3 $D/srv.log
