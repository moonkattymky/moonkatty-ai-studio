'use strict';
const { SCHEMA_VERSION } = require('./constants');
const { StudioError } = require('./errors');
const { openDatabase, transaction, migrate, tableNames } = require('./sqlite');
const { principalFromSession } = require('./auth');
const { createPermissions } = require('./permissions');
const { createMemory } = require('./memory');
const { createRetrieval } = require('./retrieval');
const { createProgress } = require('./progress');
const { createRuntimeAdapter } = require('./runtime-adapter');
const workflow = require('./workflow');
const { createApproval } = require('./approval');
const { createAssets } = require('./assets');
const { createBrand } = require('./brand');
const { createReports } = require('./reports');
const { createQaMemory } = require('./qa-memory');
const { createVoices } = require('./voices');
const { createEditorial } = require('./editorial');
const { createVersions } = require('./versions');
const { createNotices } = require('./notices');
const { createAuditFeed } = require('./audit-feed');
const { createProjects } = require('./projects');
const { createLedgerAdapter } = require('./ledger-adapter');
const { createCharacterRegistry } = require('./character-registry');
const { schemas, validate, schemaNames } = require('./validate');

function envelope({ type, principal, namespace, payload, at, id }) {
  const actor = principal && principal.role === 'agent'
    ? { id: principal.agentId || principal.id, role: 'agent' }
    : { id: principal && principal.id, role: principal && principal.role };
  const event = {
    id: id || require('crypto').randomBytes(12).toString('hex'),
    type,
    at: at || new Date().toISOString(),
    namespace,
    actor,
    payload: payload || {}
  };
  const errors = validate('event-envelope', event);
  if (errors.length) throw new StudioError('VALIDATION', errors[0], { retryable: false, details: { errors } });
  return event;
}

/**
 * @param {{ db?: object, dbPath?: string, now?: () => string }} options
 * db — уже открытый handle better-sqlite3 / lib/db.js (предпочтительно, одно соединение с панелью).
 * dbPath — путь к тому же файлу data/studio.db, если своего соединения ещё нет.
 */
function openStudioIntelligence(options = {}) {
  if (!options.db && !options.dbPath) {
    throw new StudioError('VALIDATION', 'Нужен db или dbPath существующей базы data/studio.db. Отдельная база по умолчанию не создаётся.', { retryable: false });
  }
  const owned = !options.db;
  const db = options.db || openDatabase(options.dbPath);
  migrate(db);
  const now = options.now || (() => new Date().toISOString());
  const tx = fn => transaction(db, fn);
  const permissions = createPermissions(db);
  const memory = createMemory(db, { now, transaction: tx, permissions });
  const retrieval = createRetrieval(db, { memory, permissions, transaction: tx, now });
  const progress = createProgress(db, { now, permissions });
  const runtime = createRuntimeAdapter({ permissions });
  const audit = createAuditFeed({ log: options.auditLog, now });
  const approval = createApproval(db, { now, permissions, transaction: tx, audit });
  const voices = createVoices(db, { now, permissions, transaction: tx });
  const projects = createProjects(db);
  const ledger = createLedgerAdapter({
    listEntries: options.ledger && options.ledger.listEntries,
    projects
  });
  const character = createCharacterRegistry(db, { now, permissions, transaction: tx, voices });
  const assets = createAssets(db, { now, permissions, transaction: tx, approval, voices, character });
  const brand = createBrand({ assets });
  const reports = createReports(db, { now, permissions, ledger });
  const qa = createQaMemory(db, { now, permissions, assets });
  const editorial = createEditorial(db, { now, permissions, transaction: tx });
  const versions = createVersions(db, { now, permissions, transaction: tx });
  const notices = createNotices(db, { now, permissions });
  return {
    schemaVersion: SCHEMA_VERSION,
    driver: db.driver || 'injected',
    db,
    memory,
    retrieval,
    progress,
    runtime,
    permissions,
    auth: { principalFromSession },
    workflow,
    brand,
    approval,
    assets,
    reports,
    qa,
    voices,
    projects,
    ledger,
    character,
    editorial,
    versions,
    notices,
    audit,
    contracts: { schemas, validate, schemaNames, envelope },
    tableNames: () => tableNames(db),
    close() { if (owned) db.close(); }
  };
}

module.exports = { openStudioIntelligence, StudioError, SCHEMA_VERSION };
