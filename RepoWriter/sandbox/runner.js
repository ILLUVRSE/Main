// RepoWriter/sandbox/runner.js
import vm from 'vm';

// Simple runner that reads JSON from stdin
let buffer = '';
process.stdin.on('data', data => {
  buffer += data;
});

process.stdin.on('end', () => {
  try {
    const input = JSON.parse(buffer);
    const { code, timeout = 1000 } = input;

    const sandbox = {
        console: { log: console.log },
        result: null
    };

    const ctx = vm.createContext(sandbox);

    // Execute code in VM
    try {
        vm.runInContext(code, ctx, { timeout });
        process.stdout.write(JSON.stringify({ status: 'passed', output: sandbox.result }));
    } catch (e) {
        if (e.message.includes('Script execution timed out')) {
            process.stdout.write(JSON.stringify({ status: 'timeout', error: e.message }));
        } else {
            process.stdout.write(JSON.stringify({ status: 'failed', error: e.message }));
        }
    }
  } catch (e) {
    process.stdout.write(JSON.stringify({ status: 'failed', error: 'Invalid input: ' + e.message }));
  }
});
