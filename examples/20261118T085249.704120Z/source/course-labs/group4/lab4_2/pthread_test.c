#define _GNU_SOURCE
#include <pthread.h>
#include "../lab_common.h"
/* Intentional plain-data race in unsafe mode; volatile is NOT synchronization. */
static volatile int shared_counter;
static const int increments=1000000;
static int locked;
static int *shared_heap;
static pthread_mutex_t mutex=PTHREAD_MUTEX_INITIALIZER;
static pthread_barrier_t ready,start;
static void *worker(void *arg) {
    int number=*(int *)arg,local=number;
    event("worker_start",",\"worker\":%d,\"address\":\"%p\",\"heap_address\":\"%p\",\"stack_address\":\"%p\"",number,(void *)&shared_counter,(void *)shared_heap,(void *)&local);
    int b=pthread_barrier_wait(&ready);if(b && b!=PTHREAD_BARRIER_SERIAL_THREAD) check_pthread(b,"ready barrier");
    b=pthread_barrier_wait(&start);if(b && b!=PTHREAD_BARRIER_SERIAL_THREAD) check_pthread(b,"start barrier");
    for(int i=0;i<increments;++i){
        if(locked) PT(pthread_mutex_lock(&mutex));
        shared_counter++;
        if(locked) PT(pthread_mutex_unlock(&mutex));
    }
    event("worker_end",",\"worker\":%d",number);return NULL;
}
int main(int argc,char **argv) {
    if(argc!=2 || (strcmp(argv[1],"unsafe")&&strcmp(argv[1],"mutex"))) return 2;
    locked=!strcmp(argv[1],"mutex");shared_heap=malloc(sizeof *shared_heap);if(!shared_heap) die("malloc");*shared_heap=42;
    PT(pthread_barrier_init(&ready,NULL,3));PT(pthread_barrier_init(&start,NULL,3));
    event("begin",",\"lab\":\"4.2\",\"mode\":\"%s\",\"expected\":%d,\"address\":\"%p\",\"heap_address\":\"%p\"",argv[1],2*increments,(void *)&shared_counter,(void *)shared_heap);
    pthread_t threads[2];int ids[]={1,2};
    for(int i=0;i<2;++i) PT(pthread_create(&threads[i],NULL,worker,&ids[i]));
    int b=pthread_barrier_wait(&ready);if(b && b!=PTHREAD_BARRIER_SERIAL_THREAD) check_pthread(b,"ready barrier");
    dump_status("pthread_ready",getpid(),1);
    b=pthread_barrier_wait(&start);if(b && b!=PTHREAD_BARRIER_SERIAL_THREAD) check_pthread(b,"start barrier");
    for(int i=0;i<2;++i) PT(pthread_join(threads[i],NULL));
    event("summary",",\"value\":%d,\"expected\":%d,\"mode\":\"%s\",\"heap_value\":%d",shared_counter,2*increments,argv[1],*shared_heap);
    PT(pthread_barrier_destroy(&ready));PT(pthread_barrier_destroy(&start));PT(pthread_mutex_destroy(&mutex));free(shared_heap);
    return locked && shared_counter!=2*increments?1:0;
}
