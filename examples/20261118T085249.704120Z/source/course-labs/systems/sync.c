#define _XOPEN_SOURCE 700
#include <errno.h>
#include <pthread.h>
#include <sched.h>
#include <semaphore.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void thread_check(int result) {
    if (result) { errno = result; perror("pthread"); exit(1); }
}

static void sample(const char *lab, const char *step, int observed) {
    printf("{\"kind\":\"observation\",\"lab\":\"%s\",\"phase\":\"%s\",\"observed\":%d}\n",
           lab, step, observed);
}

/* One slot, one producer, one consumer. The empty/full handoff owns the slot. */
static sem_t empty, full;
static int slot, consumed, out_of_order;

static void wait_sem(sem_t *s) {
    while (sem_wait(s) < 0) {
        if (errno != EINTR) { perror("sem_wait"); exit(1); }
    }
}

static void *consumer(void *unused) {
    (void)unused;
    for (int i = 1; i <= 32; i++) {
        wait_sem(&full);
        out_of_order += slot != i;
        consumed++;
        sem_post(&empty);
    }
    return NULL;
}

static pthread_mutex_t locks[2] = {PTHREAD_MUTEX_INITIALIZER, PTHREAD_MUTEX_INITIALIZER};
static pthread_barrier_t together;
struct lock_worker { int first, ordered, busy, finished; };

static void *lock_pair(void *arg) {
    struct lock_worker *w = arg;
    int a = w->first, b = 1 - a;
    thread_check(pthread_mutex_lock(&locks[a]));
    if (w->ordered) {
        thread_check(pthread_mutex_lock(&locks[b]));
        w->finished++;
        thread_check(pthread_mutex_unlock(&locks[b]));
    } else {
        pthread_barrier_wait(&together);  /* Both first locks are held. */
        int rc = pthread_mutex_trylock(&locks[b]);
        if (rc == EBUSY) w->busy++;
        else { thread_check(rc); thread_check(pthread_mutex_unlock(&locks[b])); }
        pthread_barrier_wait(&together);  /* Keep both locks until both probes finish. */
    }
    thread_check(pthread_mutex_unlock(&locks[a]));
    return NULL;
}

static atomic_int ready;
static int payload, received;
static void *reader(void *unused) {
    (void)unused;
    while (!atomic_load_explicit(&ready, memory_order_acquire)) sched_yield();
    received = payload;
    return NULL;
}

int main(int argc, char **argv) {
    if (argc != 2) return 2;
    const char *lab = argv[1];
    pthread_t a, b;
    if (!strcmp(lab, "5.1")) {
        if (sem_init(&empty, 0, 1) || sem_init(&full, 0, 0)) { perror("sem_init"); return 1; }
        thread_check(pthread_create(&a, NULL, consumer, NULL));
        int produced = 0;
        for (int i = 1; i <= 32; i++) {
            wait_sem(&empty);
            slot = i;
            produced++;
            sem_post(&full);
        }
        thread_check(pthread_join(a, NULL));
        sample(lab, "放入单槽缓冲区的次数", produced);
        sample(lab, "消费者取出的次数", consumed);
        sample(lab, "取出顺序与写入顺序不符的次数", out_of_order);
        sem_destroy(&empty);
        sem_destroy(&full);
    } else if (!strcmp(lab, "5.2")) {
        thread_check(pthread_barrier_init(&together, NULL, 2));
        for (int ordered = 0; ordered <= 1; ordered++) {
            struct lock_worker left = {.first = 0, .ordered = ordered};
            struct lock_worker right = {.first = !ordered, .ordered = ordered};
            thread_check(pthread_create(&a, NULL, lock_pair, &left));
            thread_check(pthread_create(&b, NULL, lock_pair, &right));
            thread_check(pthread_join(a, NULL));
            thread_check(pthread_join(b, NULL));
            if (ordered) sample(lab, "统一顺序后完成双锁操作的线程数", left.finished + right.finished);
            else sample(lab, "反向持锁时第二把锁返回 EBUSY 的线程数", left.busy + right.busy);
        }
        pthread_barrier_destroy(&together);
    } else if (!strcmp(lab, "5.3")) {
        thread_check(pthread_create(&a, NULL, reader, NULL));
        payload = 42;
        atomic_store_explicit(&ready, 1, memory_order_release);
        thread_check(pthread_join(a, NULL));
        sample(lab, "发布端写入的值", payload);
        sample(lab, "读端看到标志后读出的值", received);
    } else return 2;
    return 0;
}
