#ifndef LAB_COMMON_H
#define LAB_COMMON_H
#include <errno.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
static inline void die(const char *s) { perror(s); exit(1); }
static inline long ktid(void) { return syscall(SYS_gettid); }
static inline unsigned long long now_ns(void) {
    struct timespec t;
    if(clock_gettime(CLOCK_MONOTONIC,&t)) die("clock_gettime");
    return (unsigned long long)t.tv_sec*1000000000ULL+(unsigned long long)t.tv_nsec;
}
/* One bounded write per record keeps fork/thread output as separate JSON lines. */
static inline void event(const char *name,const char *fields,...) {
    char line[2048];
    int n=snprintf(line,sizeof line,"{\"kind\":\"event\",\"event\":\"%s\",\"pid\":%ld,\"tid\":%ld,\"time_ns\":%llu",
                   name,(long)getpid(),ktid(),now_ns());
    va_list ap;va_start(ap,fields);
    int k=vsnprintf(line+n,sizeof line-(size_t)n,fields,ap);va_end(ap);
    if(k<0 || (size_t)(n+k+3)>sizeof line) {errno=EOVERFLOW;die("event length");}
    n+=k;line[n++]='}';line[n++]='\n';
    ssize_t result;
    do {result=write(STDOUT_FILENO,line,(size_t)n);} while(result<0 && errno==EINTR);
    if(result!=n) die("event write");
}
static inline void check_pthread(int code,const char *what) {if(code){errno=code;die(what);}}
#define PT(expr) check_pthread((expr),#expr)
static inline void send_byte(int fd,char c) {
    ssize_t n;do{n=write(fd,&c,1);}while(n<0&&errno==EINTR);
    if(n!=1) die("handshake write");
}
static inline char receive_byte(int fd) {
    char c=0;ssize_t n;do{n=read(fd,&c,1);}while(n<0&&errno==EINTR);
    if(n!=1){errno=EPIPE;die("handshake read");}return c;
}
static inline int wait_child(pid_t pid) {
    int status;pid_t got;do{got=waitpid(pid,&status,0);}while(got<0&&errno==EINTR);
    if(got!=pid) die("waitpid");
    return status;
}
static inline void dump_status(const char *tag,pid_t pid,int with_threads) {
    char path[128],buffer[2048];
    snprintf(path,sizeof path,"/proc/%ld/status",(long)pid);
    FILE *f=fopen(path,"r");if(!f) die("proc status");
    fprintf(stderr,"BEGIN status=%s pid=%ld\n",tag,(long)pid);
    while(fgets(buffer,sizeof buffer,f)) fputs(buffer,stderr);
    fclose(f);fprintf(stderr,"END status\n");fflush(stderr);
    pid_t observer=fork();if(observer<0) die("observer fork");
    if(!observer){
        char id[32];snprintf(id,sizeof id,"%ld",(long)pid);
        if(dup2(STDERR_FILENO,STDOUT_FILENO)<0) _exit(126);
        if(with_threads) execlp("ps","ps","-L","-o","pid,ppid,tid,stat,comm","-p",id,(char *)NULL);
        else execlp("ps","ps","-o","pid,ppid,stat,comm","-p",id,(char *)NULL);
        _exit(127);
    }
    int status=wait_child(observer);
    if(!WIFEXITED(status)||WEXITSTATUS(status)){errno=ECHILD;die("ps observer");}
}
#endif
