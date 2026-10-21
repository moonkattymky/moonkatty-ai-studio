'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'contracts');
const schemas = Object.create(null);
for (const file of fs.readdirSync(DIR)) {
  if (!file.endsWith('.schema.json')) continue;
  schemas[file.replace(/\.schema\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
}

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function check(schema, value, at, errors) {
  if (!schema || typeof schema !== 'object') return;
  if (Object.prototype.hasOwnProperty.call(schema, 'const') && value !== schema.const) {
    errors.push(`${at}: ожидалось ${JSON.stringify(schema.const)}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${at}: значение вне списка ${schema.enum.join(', ')}`);
    return;
  }
  if (schema.type) {
    const types = [].concat(schema.type);
    const actual = typeOf(value);
    const ok = types.some(expected => {
      if (expected === 'integer') return typeof value === 'number' && Number.isInteger(value);
      if (expected === 'number') return typeof value === 'number' && Number.isFinite(value);
      return actual === expected;
    });
    if (!ok) {
      errors.push(`${at}: тип ${actual}, ожидался ${types.join('|')}`);
      return;
    }
  }
  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${at}: короче ${schema.minLength}`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${at}: длиннее ${schema.maxLength}`);
    if (schema.pattern && !(new RegExp(schema.pattern).test(value))) errors.push(`${at}: не соответствует шаблону`);
    if (schema.format === 'date-time' && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(value)) {
      errors.push(`${at}: ожидалась дата ISO-8601 UTC`);
    }
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${at}: меньше ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${at}: больше ${schema.maximum}`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${at}: мало элементов`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${at}: много элементов`);
    if (schema.items) value.forEach((item, i) => check(schema.items, item, `${at}[${i}]`, errors));
  }
  if (typeOf(value) === 'object') {
    const props = schema.properties;
    if (schema.required) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) errors.push(`${at}.${key}: обязательно`);
      }
    }
    if (props && schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!Object.prototype.hasOwnProperty.call(props, key)) errors.push(`${at}.${key}: лишнее поле`);
      }
    }
    if (props) {
      for (const key of Object.keys(props)) {
        if (Object.prototype.hasOwnProperty.call(value, key)) check(props[key], value[key], `${at}.${key}`, errors);
      }
    }
  }
}

function validate(name, value) {
  const schema = schemas[name];
  if (!schema) throw new Error('Неизвестная схема: ' + name);
  const errors = [];
  check(schema, value, '$', errors);
  return errors;
}

module.exports = { schemas, validate, schemaNames: () => Object.keys(schemas).sort() };
