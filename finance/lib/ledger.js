const path = require('path');
const tsNode = require('ts-node');

const project = path.resolve(__dirname, '../tsconfig.json');
tsNode.register({ project, transpileOnly: true });

const facade = require('../service/src/ledgerFacade');

module.exports = {
  postJournal: facade.postJournal,
  getJournal: facade.getJournal,
};
