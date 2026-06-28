'use strict';
// Register a `grunt i18n` task. In your Gruntfile.js:
//   require('@wbcom/i18n-ai/grunt')(grunt);
//   grunt.registerTask('build', ['makepot', 'i18n', 'rtlcss', 'cssmin', 'uglify']);
module.exports = function (grunt) {
  const { loadConfig, syncLocales, translatePo, compileLocales } = require('../lib');
  grunt.registerTask('i18n', 'Sync + AI-translate + compile locale .po files', function () {
    const done = this.async();
    (async () => {
      const cfg = loadConfig(process.cwd());
      const w = (m) => grunt.log.writeln(m);
      grunt.log.subhead('i18n: sync'); syncLocales(cfg, w);
      grunt.log.subhead('i18n: translate');
      for (const loc of cfg.locales) await translatePo(loc.poFile, loc, cfg, w);
      grunt.log.subhead('i18n: compile'); compileLocales(cfg, w);
    })().then(() => done(), (e) => { grunt.log.error(e.message); done(false); });
  });
};
