#define _GNU_SOURCE
#include <ucontext.h>
#include "../lab_common.h"
#define N 3
#define STACK_BYTES (1024*1024)
enum state {READY,RUNNING,FINISHED};
struct uthread {ucontext_t context;char *stack;enum state state;};
static struct uthread threads[N];
static ucontext_t scheduler;
static int current=-1,blocking;
static void yield(void) {
    threads[current].state=READY;
    if(swapcontext(&threads[current].context,&scheduler)) die("yield");
}
static void body(int id) {
    for(int step=1;step<=3;++step){
        int local=step;
        event("step",",\"worker\":%d,\"step\":%d,\"stack_address\":\"%p\"",id,step,(void *)&local);
        if(blocking && id==0 && step==1){
            struct timespec delay={0,200000000};
            event("block_begin",",\"worker\":0");
            while(nanosleep(&delay,&delay) && errno==EINTR){}
            event("block_end",",\"worker\":0");
        }
        yield();
    }
    threads[id].state=FINISHED;event("finished",",\"worker\":%d",id);
    /* Returning activates uc_link, which is the scheduler context. */
}
static void create_thread(int id) {
    struct uthread *t=&threads[id];t->stack=malloc(STACK_BYTES);if(!t->stack) die("stack allocation");
    t->state=READY;if(getcontext(&t->context)) die("getcontext");
    t->context.uc_stack.ss_sp=t->stack;t->context.uc_stack.ss_size=STACK_BYTES;t->context.uc_stack.ss_flags=0;t->context.uc_link=&scheduler;
    makecontext(&t->context,(void (*)(void))body,1,id);
    event("created",",\"worker\":%d,\"stack_base\":\"%p\",\"stack_bytes\":%d",id,(void *)t->stack,STACK_BYTES);
}
int main(int argc,char **argv) {
    if(argc!=2 || (strcmp(argv[1],"round-robin")&&strcmp(argv[1],"blocking"))) return 2;
    blocking=!strcmp(argv[1],"blocking");event("begin",",\"lab\":\"4.3\",\"mode\":\"%s\"",argv[1]);
    for(int i=0;i<N;++i) create_thread(i);
    dump_status("uthread_ready",getpid(),1);
    int finished=0;
    while(finished<N){
        int next=-1;
        for(int offset=1;offset<=N;++offset){int id=(current+offset)%N;if(threads[id].state==READY){next=id;break;}}
        if(next<0) break;
        current=next;threads[next].state=RUNNING;event("dispatch",",\"worker\":%d",next);
        if(swapcontext(&scheduler,&threads[next].context)) die("scheduler swapcontext");
        if(threads[next].state==FINISHED) ++finished;
    }
    event("summary",",\"value\":%d,\"expected\":3",finished);
    for(int i=0;i<N;++i) free(threads[i].stack);
    return finished==N?0:1;
}
