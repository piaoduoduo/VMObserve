#!/bin/bash
set -euo pipefail
cd /home/oslab/os-course/group12-20261116/container
mkdir -p results
exec > >(tee results/build-original-retry.log) 2>&1
date -u
isula version
isula-build version
sha256sum Dockerfile hello.c
timeout 1800 isula-build ctr-img build -f Dockerfile -o isulad:gcc-lab:course-20261116 .
isula-build ctr-img images
isula images
isula run --name oslab-hello-20261116 gcc-lab:course-20261116
isula inspect oslab-hello-20261116 > results/hello-inspect.json
echo ORIGINAL_CONTAINER_COMPLETED
