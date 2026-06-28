'use strict';
module.exports = {
  loadConfig: require('./config').loadConfig,
  syncLocales: require('./sync').syncLocales,
  translatePo: require('./translate').translatePo,
  compileLocales: require('./compile').compileLocales,
};
