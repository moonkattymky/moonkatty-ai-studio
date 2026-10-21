'use strict';
const { UNASSIGNED_PROJECT, PROJECT_SEEDS } = require('./constants');

const BY_ID = new Map(PROJECT_SEEDS.map(([projectId, namespace, slug, title]) => [
  projectId,
  { projectId, namespace, slug: slug || null, title }
]));

/**
 * Синхронный разбор projectId. Studio 3 делает require этого файла и вызывает
 * resolveProject без открытой базы. Ответ — обычный объект, не Promise.
 * Неизвестный id остаётся в rawProjectId и относится к unassigned.
 */
function resolveProject(projectId) {
  const raw = projectId == null || projectId === '' ? null : String(projectId).slice(0, 140);
  if (raw == null || raw === UNASSIGNED_PROJECT) {
    return {
      projectId: UNASSIGNED_PROJECT,
      rawProjectId: raw,
      known: raw === UNASSIGNED_PROJECT,
      namespace: null,
      slug: null,
      dropped: false
    };
  }
  const seed = BY_ID.get(raw);
  if (!seed) {
    return {
      projectId: UNASSIGNED_PROJECT,
      rawProjectId: raw,
      known: false,
      namespace: null,
      slug: null,
      dropped: false
    };
  }
  return {
    projectId: seed.projectId,
    rawProjectId: raw,
    known: true,
    namespace: seed.namespace,
    slug: seed.slug,
    dropped: false
  };
}

/**
 * Реестр projectId для журнала Studio 3.
 * Запись денег здесь не создаётся.
 */
function createProjects(db) {
  const listStmt = db.prepare('SELECT * FROM si_projects ORDER BY project_id');

  function map(row) {
    return {
      projectId: row.project_id,
      namespace: row.namespace,
      slug: row.slug || null,
      title: row.title
    };
  }

  function list() {
    return listStmt.all().map(map);
  }

  return { resolveProject, list };
}

module.exports = { createProjects, resolveProject };
