const fs = require('fs');
const path = require('path');

const fixturesPath = path.join(__dirname, '../test/fixtures/products.json');
const fixtures = fs.readFileSync(fixturesPath, 'utf-8');

console.log(fixtures);
