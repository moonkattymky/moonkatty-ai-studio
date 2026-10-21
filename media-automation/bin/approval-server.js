#!/usr/bin/env node
'use strict';
// Standalone Approval Center (NOT the main app). Binds 127.0.0.1 only. Token: Keychain/env secret "approval_token" (MA_SECRET_APPROVAL_TOKEN).
// Usage: node media-automation/bin/approval-server.js <stateDir> [port] [mediaRoot...]
const path = require('path'); const express = require('express');
const { ApprovalCenter, createApprovalRouter } = require('../src/approval'); const { ChainSecrets } = require('../src/secrets');
(async () => {
  const [stateDir = path.join(__dirname, '..', 'state'), port = 8795, ...roots] = process.argv.slice(2);
  const token = await new ChainSecrets().require('approval_token');
  const center = new ApprovalCenter({ statePath: path.join(stateDir, 'approval.json') });
  const app = express(); app.disable('x-powered-by'); app.use('/approval', createApprovalRouter({ center, token, mediaRoots: roots.length ? roots : [stateDir] }));
  app.listen(+port, '127.0.0.1', () => console.log(`Approval Center on http://127.0.0.1:${port}/approval/ (token required)`));
})().catch(e => { console.error(e.message); process.exit(1); });
