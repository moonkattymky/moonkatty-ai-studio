'use strict';
module.exports = { ...require('./humor'), ...require('./emotion'), ...require('./formats'), ...require('./pipeline') };
module.exports = { ...module.exports, ...require('./cues') };
module.exports = { ...module.exports, ...require('./scriptwriter') };
