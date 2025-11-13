// sandboxRunner.ts

import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

export async function runSandbox(command: string): Promise<{ status: string }> {
    try {
        const { stdout, stderr } = await execPromise(command);
        console.log(stdout);
        if (stderr) {
            return { status: 'fail' };
        }
        return { status: 'complete' };
    } catch (error) {
        console.error(error);
        return { status: 'fail' };
    }
}

// Additional code to secure the runtime and ensure auditability would go here.