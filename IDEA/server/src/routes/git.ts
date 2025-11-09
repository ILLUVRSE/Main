import { Router } from 'express';
import simpleGit from 'simple-git';

const router = Router();

router.get('/status', async (_req, res) => {
  try {
    const status = await simpleGit().status();
    return res.json({ ok: true, status });
  } catch (err: any) {
    const message = err?.message ?? 'Unable to read git status';
    return res.status(500).json({ ok: false, error: message });
  }
});

router.get('/diff', async (req, res) => {
  try {
    const git = simpleGit();
    const diff = req.query.staged === 'true' ? await git.diff(['--cached']) : await git.diff();
    return res.json({ ok: true, diff });
  } catch (err: any) {
    const message = err?.message ?? 'Unable to compute git diff';
    return res.status(500).json({ ok: false, error: message });
  }
});

router.post('/commit', async (req, res) => {
  const message = req.body?.message;
  const pushRequested = Boolean(req.body?.push);

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ ok: false, error: 'commit message is required' });
  }

  if (pushRequested && process.env.GIT_ALLOW_PUSH !== 'true') {
    return res.status(403).json({ ok: false, error: 'GIT_ALLOW_PUSH not set' });
  }

  const git = simpleGit();

  try {
    await git.add(['-A']);
    const commitResult = await git.commit(message.trim());
    const result: Record<string, unknown> = { commit: commitResult };

    if (pushRequested) {
      const pushResult = await git.push();
      result.push = pushResult;
    }

    return res.json({ ok: true, result });
  } catch (err: any) {
    const errMessage = err?.message ?? 'Failed to commit changes';
    return res.status(500).json({ ok: false, error: errMessage });
  }
});

export default router;
