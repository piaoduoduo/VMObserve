#!/bin/bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
mkdir -p .build
for source in lab4_1/fork_exec_wait.c lab4_1/child_prog.c lab4_2/pthread_test.c lab4_3/user_thread_test.c lab4_4/pipe_communication.c lab4_4/thread_communication.c; do
  name="$(basename "$source" .c)"
  echo "Building $name"
  gcc -std=gnu11 -O2 -g -Wall -Wextra -Werror "$source" -o ".build/$name" -pthread
done
