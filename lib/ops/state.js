// Small JSON state file with atomic writes (tmp + rename), mode 0600.
'use strict';
const fs = require('fs'), path = require('path');
function stateFile(file, defaults = {}) {
  const load = () => { try { return Object.assign({}, defaults, JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { return Object.assign({}, defaults); } };
  const save = obj => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 }); fs.renameSync(tmp, file); return obj; };
  return { file, load, save };
}
module.exports = { stateFile };
