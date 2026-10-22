'use strict';
// v1.3.2-test candidate — SINGLE shared 3D choke point (owner decision: 3D Studio is NOT approved in this build).
// Every 3D entry uses assert3dAllowed(): job creation (design3d / blender_template), runner dispatch for the design3d agent,
// /api/studio3d/* writes, /api/projects3d/:pid/:ver/(rerender|run), Director chat plans that target 3D, job retry/confirm/review
// of 3D jobs, the design3d executor entry, the blender_template service and lib/blender.js itself (every Blender spawn) —
// so any path not listed here still fails closed at the Blender/executor layer. Flip only by a reviewed code change.
const DESIGN3D_ENABLED = false;
const DESIGN3D_DISABLED_MSG = 'design3d недоступен в этой тестовой сборке (3D-студия не одобрена)';
const TYPES_3D = new Set(['design3d', 'blender_template', '3d']);
const AGENTS_3D = new Set(['design3d']);
const hits = new Map(); // where -> count (diagnostics / tests)
function disabledError(where) { return Object.assign(new Error(DESIGN3D_DISABLED_MSG), { status: 403, code: 'feature_disabled', feature: 'design3d', where }); }
function assert3dAllowed(where = 'unknown') { if (DESIGN3D_ENABLED) return true; hits.set(where, (hits.get(where) || 0) + 1); throw disabledError(where); }
const is3dType = t => TYPES_3D.has(String(t || ''));
const is3dAgent = id => AGENTS_3D.has(String(id || ''));
const body403 = e => ({ error: DESIGN3D_DISABLED_MSG, code: 'feature_disabled', feature: 'design3d', where: e && e.where });
function send403(res, where) { try { assert3dAllowed(where); return false; } catch (e) { res.status(403).json(body403(e)); return true; } }
const guard = where => (req, res, next) => { if (!send403(res, where || req.method + ' ' + req.path)) next(); };
module.exports = { DESIGN3D_ENABLED, DESIGN3D_DISABLED_MSG, TYPES_3D, assert3dAllowed, is3dType, is3dAgent, send403, guard, body403, disabledError,
  status: () => ({ feature: 'design3d', enabled: DESIGN3D_ENABLED, message: DESIGN3D_ENABLED ? null : DESIGN3D_DISABLED_MSG, hits: Object.fromEntries(hits) }) };
