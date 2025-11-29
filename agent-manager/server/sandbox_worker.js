// agent-manager/server/sandbox_worker.js
const { spawn } = require('child_process');
const path = require('path');

exports.runTask = function(taskPayload) {
  return new Promise((resolve, reject) => {
    // Path to the runner script
    const runnerPath = path.resolve(__dirname, '../../RepoWriter/sandbox/runner.js');

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
      if (code !== 0) {
        // If the process crashed
        return resolve({ status: 'failed', logs: errorOutput || 'Process exited with error' });
      }
      try {
        const result = JSON.parse(output);
        resolve({ ...result, logs: output });
      } catch (e) {
        resolve({ status: 'failed', logs: 'Invalid JSON output from runner: ' + output });
      }
    });

    // Send payload
    child.stdin.write(JSON.stringify(taskPayload));
    child.stdin.end();

    // Safety timeout
    setTimeout(() => {
        if (!child.killed) {
            child.kill();
            resolve({ status: 'timeout', logs: 'Worker timed out' });
        }
    }, (taskPayload.timeout || 1000) + 500); // Allow slightly more than the VM timeout
  });
};
