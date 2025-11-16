'use strict';
const fs = require('fs');
const path = require('path');

function run() {
  const p = path.join(__dirname, '..', 'openapi.yaml');
  if (!fs.existsSync(p)) {
    console.error('MISSING', p);
    process.exit(2);
  }
  console.log('ok');
  process.exit(0);
}

if (require.main === module) run();
module.exports = run;
