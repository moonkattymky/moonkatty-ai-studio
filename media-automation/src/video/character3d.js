'use strict';
// Back-compat alias: the Character3D adapter is now the unified Host3D interface (src/host3d).
const { StubHost3D } = require('../host3d');
class StubCharacter3D extends StubHost3D { constructor() { super(); this.name = 'stub-3d'; } }
module.exports = { StubCharacter3D };
