#!/bin/sh
export PATH=/home/box/node22/bin:$PATH; cd /workspace/qa133/repo
D=/tmp/mk-test-live; mkdir -p $D/data; echo qa-live-$(date +%s%N) > $D/pw
STUDIO_ADMIN_PASSWORD=$(cat $D/pw) STUDIO_DATA_DIR=$D/data PORT=18992 HOST=127.0.0.1 NODE_ENV=production node -r /workspace/qa133/rssmock.cjs /workspace/qa133/res/app.asar.unpacked/server.js > $D/srv.log 2>&1 &
SP=$!; for i in $(seq 60); do curl -sf http://127.0.0.1:18992/api/health >/dev/null && break; sleep 0.5; done
echo "== newsvideo-security"; STUDIO_URL=http://127.0.0.1:18992 PW_FILE=$D/pw node scripts/newsvideo-security-test.mjs 2>&1 | tail -4
for i in 1 2 3; do echo "== owner-approval-real $i"; REAL_URL=http://127.0.0.1:18992 PW_FILE=$D/pw node scripts/owner-approval-real-test.mjs 2>&1 | tail -3; echo exit=$?; done
echo "== longword"; node scripts/longword-test.mjs 2>&1 | tail -3
kill $SP
