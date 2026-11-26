#define _GNU_SOURCE
#include <signal.h>
#include <string.h>
#include <sys/wait.h>
#include "group3_snapshot.h"
static volatile unsigned long checksum;
static struct rusage previous;
/* Volatile page touches, a post-call use, and explicit compiler switches keep
 * the recursive frames alive. The monitoring parent never overflows. */
__attribute__((noinline)) static void descend(unsigned depth,unsigned target) {
    volatile unsigned char frame[8192];
    frame[0]=(unsigned char)depth; frame[4096]=7; frame[8191]=9;
    if (depth%16==0 || depth==target) {
        snapshot("stack",(uintptr_t)&frame[0],depth,previous);
        previous=usage();
    }
    if (depth<target) descend(depth+1,target);
    checksum+=frame[0]+frame[4096]+frame[8191];
}
int main(int argc,char **argv) {
    if(argc!=3) return 2;
    int overflow=!strcmp(argv[1],"overflow");
    unsigned long limit=strtoul(argv[2],NULL,10);
    if((!overflow && strcmp(argv[1],"normal")) || (limit!=512 && limit!=2048 && limit!=8192)) return 2;
    setup();
    pid_t child=fork();
    if(child<0) fail("fork");
    if(!child) {
        struct rlimit stack,core={0,0};
        if(getrlimit(RLIMIT_STACK,&stack)) fail("getrlimit");
        stack.rlim_cur=limit*1024;
        if(setrlimit(RLIMIT_STACK,&stack) || setrlimit(RLIMIT_CORE,&core)) fail("setrlimit");
        printf("{\"kind\":\"condition\",\"mode\":\"%s\",\"pid\":%ld,\"limit_kib\":%lu,"
               "\"frame_bytes\":8192,\"target_depth\":%d,\"page_bytes\":%ld}\n",
               argv[1],(long)getpid(),limit,overflow?4096:64,sysconf(_SC_PAGESIZE));
        previous=usage();
        int local=0;
        snapshot("before_stack",(uintptr_t)&local,0,previous);
        previous=usage();
        descend(1,overflow?4096:64);
        printf("{\"kind\":\"returned\",\"checksum\":%lu}\n",checksum);
        _exit(0);
    }
    int status; struct rusage child_usage;
    if(wait4(child,&status,0,&child_usage)<0) fail("wait4");
    printf("{\"kind\":\"outcome\",\"child_pid\":%ld,\"signal\":%d,\"exit_code\":%d,"
           "\"minor\":%ld,\"major\":%ld,\"maxrss_kib\":%ld}\n",
           (long)child,WIFSIGNALED(status)?WTERMSIG(status):0,WIFEXITED(status)?WEXITSTATUS(status):-1,
           child_usage.ru_minflt,child_usage.ru_majflt,child_usage.ru_maxrss);
    return overflow?(WIFSIGNALED(status)&&WTERMSIG(status)==SIGSEGV?0:1):(WIFEXITED(status)&&WEXITSTATUS(status)==0?0:1);
}
