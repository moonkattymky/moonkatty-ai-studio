'use strict';
const fs = require('fs');
const path = require('path');

/** Restart-safe JSON key/value store with atomic writes. */
class JsonStore {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.data = {};
    if (fs.existsSync(file)) {
      try { this.data = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (e) { throw new Error(`StateStore corrupted: ${file}: ${e.message}`); }
    }
  }
  get(key, def) { return key in this.data ? structuredClone(this.data[key]) : def; }
  set(key, value) { this.data[key] = structuredClone(value); this.flush(); return value; }
  update(key, fn, def) { return this.set(key, fn(this.get(key, def))); }
  flush() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    fs.writeSync(fd, JSON.stringify(this.data, null, 2));
    fs.fsyncSync(fd); fs.closeSync(fd);
    fs.renameSync(tmp, this.file);
  }
}
module.exports = { JsonStore };
