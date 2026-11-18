#!/bin/bash
set -euo pipefail
cd /home/oslab/os-course/group12-20261116
test "$(id -u)" -ne 0
repo="$PWD/community"
base=$(cat git-evidence/base-commit.txt)
commit=$(cat git-evidence/practice-commit.txt)
out="$PWD/git-results/$(date -u +%Y%m%dT%H%M%S)-$$"
mkdir -p "$out"
exec > >(tee "$out/session.log") 2>&1
whoami
git -C "$repo" remote -v
git -C "$repo" branch -a
git -C "$repo" log --oneline -5
git -C "$repo" show --stat "$commit"
git -C "$repo" diff "$base" "$commit" -- oslab-practice.md > "$out/lab.patch"
git -C "$repo" format-patch -1 "$commit" --output-directory "$out"
for method in apply am;do
    git clone --quiet --no-checkout --no-hardlinks "$repo" "$out/$method"
    git -C "$out/$method" config user.name 'OS Course Practice (AI-assisted)'
    git -C "$out/$method" config user.email 'oslab@localhost'
    git -C "$out/$method" sparse-checkout init --no-cone
    git -C "$out/$method" sparse-checkout set /oslab-practice.md
    git -C "$out/$method" checkout --quiet --detach "$base"
done
git -C "$out/apply" apply --check "$out/lab.patch"
git -C "$out/apply" apply "$out/lab.patch"
git -C "$out/apply" add oslab-practice.md
git -C "$out/am" am "$out/0001-docs-add-local-OS-course-practice-notes.patch"
expected=$(git -C "$repo" rev-parse "$commit^{tree}")
applied=$(git -C "$out/apply" write-tree)
mailed=$(git -C "$out/am" rev-parse 'HEAD^{tree}')
test "$expected" = "$applied"
test "$expected" = "$mailed"
python3 - "$out" "$base" "$commit" "$expected" "$applied" "$mailed" <<'PY'
import json,pathlib,sys
p=pathlib.Path(sys.argv[1])
data=dict(status='passed',network_required=False,base_commit=sys.argv[2],practice_commit=sys.argv[3],expected_tree=sys.argv[4],git_apply_tree=sys.argv[5],git_am_tree=sys.argv[6])
(p/'summary.json').write_text(json.dumps(data,indent=2)+'\n')
print(json.dumps(data,indent=2))
PY
echo "GIT_DEMO_RESULT=$out"
