# RepoWriter

Local web tool that:
- takes narrative prompts
- plans multi-file edits
- shows diffs
- applies changes to a local repo (REPO_PATH)
- tracks tokens/usage and memory
- commits & pushes to GitHub

## Dev
1) Copy `server/.env.example` to `server/.env` and fill it.
2) Copy `web/.env.example` to `web/.env`.
3) In both `server` and `web`: `npm i`
4) Run server: `npm --prefix server run dev`
5) Run web: `npm --prefix web run dev`

