#!/usr/bin/env python3
"""
Minimal autorun: read FINAL_COMPLETION_CRITERIA.md checklist and call generator for each unchecked item.
Usage:
  export REPOWRITER_BASE_URL="http://localhost:7071"
  python3 tools/illuvrse_autorun.py --file FINAL_COMPLETION_CRITERIA.md --mode pr --yes
"""
import os, sys, re, argparse, subprocess, json, time

GEN = "python3"

def load_tasks(mdfile):
    tasks = []
    cur = "Uncategorized"
    with open(mdfile,'r',encoding='utf8') as f:
        for ln in f:
            h = re.match(r'^\s{0,3}#{2,}\s*(.+)', ln)
            if h:
                cur = h.group(1).strip()
            m = re.match(r'^\s*[\*\-]\s*\[\s*\]\s*(.+)', ln)
            if m:
                tasks.append((cur, m.group(1).strip()))
    return tasks

def run_task(module, text, mode="pr", yes=False):
    allowed = "RepoWriter/server/,src/services/,src/"
    cmd = [GEN, "tools/illuvrse_generator.py", "--task", text, "--acceptance", text, "--allowed", allowed]
    if mode == "apply":
        cmd.append("--apply")
    if mode == "pr" and yes:
        cmd += ["--apply"] if False else []  # keep PR creation in generator by default
    print("RUN:", " ".join(cmd[:8]) + " ...")
    try:
        subprocess.run(cmd, check=True)
        print("Done.")
    except subprocess.CalledProcessError as e:
        print("Task failed:", e)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default="FINAL_COMPLETION_CRITERIA.md")
    ap.add_argument("--mode", choices=["pr","apply"], default="pr")
    ap.add_argument("--yes", action="store_true")
    args = ap.parse_args()
    tasks = load_tasks(args.file)
    print("Found", len(tasks), "unchecked tasks.")
    for i,(mod,txt) in enumerate(tasks, start=1):
        print(f"\n--- ({i}/{len(tasks)}) {mod}: {txt[:80]}")
        run_task(mod, txt, mode=args.mode, yes=args.yes)
        time.sleep(1)

if __name__ == "__main__":
    main()

