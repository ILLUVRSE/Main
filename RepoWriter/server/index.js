console.warn(
  'DEPRECATED: RepoWriter/server has moved to artifact-publisher/server. Please update imports before the deprecation window closes.',
);

module.exports = require('../../artifact-publisher/server/dist/index.js');
