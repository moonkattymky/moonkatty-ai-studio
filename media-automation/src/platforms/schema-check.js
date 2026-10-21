'use strict';
/** Minimal JSON-Schema subset validator (type, required, properties, items, enum, additionalProperties:false, $ref to #/$defs). No deps. */
function check(schema, v, path = '$', root = schema, errs = []) {
  if (schema.$ref) return check(root.$defs[schema.$ref.replace('#/$defs/', '')], v, path, root, errs);
  const types = [].concat(schema.type || []); const t = v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v;
  if (types.length && !types.some(x => x === t || (x === 'number' && t === 'integer'))) { errs.push(`${path}: expected ${types.join('|')} got ${t}`); return errs; }
  if (schema.enum && !schema.enum.includes(v)) errs.push(`${path}: not in enum`);
  if (schema.const !== undefined && v !== schema.const) errs.push(`${path}: must be ${schema.const}`);
  if (t === 'object') { for (const r of schema.required || []) if (!(r in v)) errs.push(`${path}.${r}: required`);
    for (const [k, val] of Object.entries(v)) { if (schema.properties?.[k]) check(schema.properties[k], val, `${path}.${k}`, root, errs);
      else if (schema.additionalProperties === false) errs.push(`${path}.${k}: not allowed`); else if (typeof schema.additionalProperties === 'object') check(schema.additionalProperties, val, `${path}.${k}`, root, errs); } }
  if (t === 'array' && schema.items) v.forEach((x, i) => check(schema.items, x, `${path}[${i}]`, root, errs));
  return errs;
}
module.exports = { check };
