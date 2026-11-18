#!/bin/bash
set -euo pipefail
cd /home/oslab/os-course/group12-20261116
mkdir -p git-evidence
out="$PWD/git-evidence"
exec > >(tee "$out/workflow.log") 2>&1
test "$(id -u)" -ne 0
whoami
git --version
cd community
git remote -v | tee "$out/remote.txt"
git log --oneline -5 | tee "$out/history-before.txt"
git branch -a | tee "$out/branches-before.txt"
base=$(git rev-parse HEAD)
printf '%s\n' "$base" > "$out/base-commit.txt"
git config --local user.name 'OS Course Practice (AI-assisted)'
git config --local user.email 'oslab@localhost'
git switch -c lab-patch
cat > oslab-practice.md <<'NOTES'
# Local operating-systems course practice

This file is a local Git exercise. It is not an upstream contribution.

- Issue: describe a problem and its reproduction steps.
- Branch: keep an experimental change separate from the baseline.
- Diff: inspect the actual file changes before committing.
- Commit: record one reviewed change in the local history.
- Patch: export that change so another checkout can apply it.
- Pull request: ask maintainers to review and merge a branch.

Course linkage: a container runs isolated processes on the host kernel.
Compare the container PID namespace with fork/exec and process observations.

Prepared by OpenAI Codex desktop with GPT-6 assistance for a local course
exercise. The exact desktop build was not recorded. The user still needs to
practice and explain the workflow. No issue, PR, or remote push was sent.
NOTES
git add -N oslab-practice.md
git diff --check
git diff -- oslab-practice.md > "$out/lab.patch"
git diff --stat
git add oslab-practice.md
git commit -m 'docs: add local OS-course practice notes' -m 'Local teaching exercise prepared with OpenAI Codex desktop (exact client build not recorded), model GPT-6. Prompt: complete the HUST OS Git workflow and verify generated patches. No upstream contribution is claimed.' -m 'Co-Authored-By: GPT-6 (OpenAI Codex)'
git format-patch -1 HEAD --output-directory "$out"
git log -1 --format=fuller > "$out/commit.txt"
git status --short > "$out/status-after.txt"
test ! -s "$out/status-after.txt"
head=$(git rev-parse HEAD)
tree=$(git rev-parse 'HEAD^{tree}')
printf '%s\n' "$head" > "$out/practice-commit.txt"
cd ..
for name in git-apply-check git-am-check;do
    git clone --no-checkout --no-hardlinks community "$name"
    git -C "$name" config --local user.name 'OS Course Practice (AI-assisted)'
    git -C "$name" config --local user.email 'oslab@localhost'
    git -C "$name" sparse-checkout init --no-cone
    git -C "$name" sparse-checkout set '/oslab-practice.md'
    git -C "$name" checkout --detach "$base"
done
cd git-apply-check
git apply --check "$out/lab.patch"
git apply "$out/lab.patch"
git add oslab-practice.md
applied=$(git write-tree)
test "$applied" = "$tree"
cd ../git-am-check
git am "$out/0001-docs-add-local-OS-course-practice-notes.patch"
mailed=$(git rev-parse 'HEAD^{tree}')
test "$mailed" = "$tree"
git log -1 --format=fuller > "$out/applied-commit.txt"
git status --short > "$out/applied-status.txt"
test ! -s "$out/applied-status.txt"
cd ..
cp community/README_cn.md community/AGENTS.md community/CONTRIBUTING.md community/LICENSE git-evidence/
python3 - "$out" "$base" "$head" "$tree" "$applied" "$mailed" <<'PY'
import hashlib,json,pathlib,sys
p=pathlib.Path(sys.argv[1])
patches={x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in p.glob('*.patch')}
summary={'status':'passed','upstream':'https://github.com/openeuler-mirror/community.git','original_url_attempt':'https://atomgit.com/openeuler/community.git returned HTTP 418','base_commit':sys.argv[2],'practice_commit':sys.argv[3],'expected_tree':sys.argv[4],'git_apply_tree':sys.argv[5],'git_am_tree':sys.argv[6],'patches':patches,'remote_push':False,'real_pr':False,'identity':'OS Course Practice (AI-assisted) <oslab@localhost>'}
(p/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
PY
echo GIT_WORKFLOW_PASSED
