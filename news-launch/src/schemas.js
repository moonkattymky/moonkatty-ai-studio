'use strict';
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'schemas');

function load(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
}

const SCHEMAS = {
  storyCandidate: load('story-candidate.json'),
  factCheck: load('fact-check-result.json'),
  script: load('script.json'),
  voiceover: load('voiceover.json'),
  renderJob: load('video-render-job.json'),
  qc: load('qc-result.json'),
  approval: load('approval-request.json'),
};

function assertSchema(obj, schema, label) {
  const missing = [];
  for (const key of schema.required || []) {
    if (obj == null || obj[key] === undefined) missing.push(key);
  }
  if (missing.length) {
    throw new Error(`${label || schema.title} missing ${missing.join(', ')}`);
  }
  const checkEnum = (value, prop, propName) => {
    if (!prop || value == null) return;
    if (prop.const !== undefined && value !== prop.const) {
      throw new Error(`${label || schema.title} ${propName} must be ${JSON.stringify(prop.const)}`);
    }
    if (prop.enum && !prop.enum.includes(value)) {
      throw new Error(`${label || schema.title} ${propName} not in ${prop.enum.join('|')}`);
    }
  };
  for (const [name, prop] of Object.entries(schema.properties || {})) checkEnum(obj[name], prop, name);
  return obj;
}

module.exports = { SCHEMAS, assertSchema };
