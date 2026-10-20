'use strict';
const { UNASSIGNED_PROJECT } = require('./constants');

/**
 * Реестр projectId для журнала Studio 3.
 * Неизвестный идентификатор остаётся в ответе как rawProjectId и относится к unassigned.
 * Запись денег здесь не создаётся.
 */
function createProjects(db) {
  const getStmt = db.prepare('SELECT * FROM si_projects WHERE project_id = ?');
  const listStmt = db.prepare('SELECT * FROM si_projects ORDER BY project_id');

  function map(row) {
    return {
      projectId: row.project_id,
      namespace: row.namespace,
      slug: row.slug || null,
      title: row.title
    };
  }

  function resolveProject(projectId) {
    const raw = projectId == null || projectId === '' ? null : String(projectId).slice(0, 80);
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
    const row = getStmt.get(raw);
    if (!row) {
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
      projectId: row.project_id,
      rawProjectId: raw,
      known: true,
      namespace: row.namespace,
      slug: row.slug || null,
      dropped: false
    };
  }

  function list() {
    return listStmt.all().map(map);
  }

  return { resolveProject, list };
}

module.exports = { createProjects };
