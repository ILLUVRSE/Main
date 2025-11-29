// tools/test_runner_standalone.js
const { spawn } = require('child_process');
const path = require('path');

const runnerPath = path.resolve(__dirname, '../RepoWriter/sandbox/runner.js');
console.log('Runner path:', runnerPath);

const child = spawn('node', [runnerPath], {
  stdio: ['pipe', 'pipe', 'pipe']
});

let output = '';
let errorOutput = '';

child.stdout.on('data', (data) => {
  output += data.toString();
});

child.stderr.on('data', (data) => {
  errorOutput += data.toString();
});

child.on('close', (code) => {
  console.log('Exit code:', code);
  console.log('Output:', output);
  console.log('Error output:', errorOutput);
});

const taskPayload = {
    code: 'result = 1 + 1;',
    timeout: 1000
};

child.stdin.write(JSON.stringify(taskPayload));
child.stdin.end();
