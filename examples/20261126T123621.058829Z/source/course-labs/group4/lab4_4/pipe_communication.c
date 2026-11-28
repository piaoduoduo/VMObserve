#define _GNU_SOURCE
#include <fcntl.h>
#include <signal.h>
#include "../lab_common.h"
static const char message[]="Hello from Parent Process!";
int main(int argc,char **argv) {
    if(argc!=2) return 2;
    const char *mode=argv[1];
    if(strcmp(mode,"basic")&&strcmp(mode,"eof")&&strcmp(mode,"eagain")&&strcmp(mode,"epipe")&&strcmp(mode,"sigpipe")) return 2;
    int fd[2];if(pipe(fd)) die("pipe");
    event("begin",",\"lab\":\"4.4-pipe\",\"mode\":\"%s\"",mode);
    if(!strcmp(mode,"basic")){
        pid_t child=fork();if(child<0) die("fork");
        if(!child){
            close(fd[1]);char buffer[256];size_t total=0;ssize_t n;
            /* Read deliberately small pieces: pipes carry bytes, not messages. */
            while((n=read(fd[0],buffer+total,3))>0) total+=(size_t)n;
            if(n<0) die("read");
            buffer[total]='\0';close(fd[0]);
            event("received",",\"role\":\"child\",\"read_bytes\":%zu,\"message\":\"%s\",\"eof\":true",total,buffer);
            _exit(total==strlen(message)&&!strcmp(buffer,message)?0:1);
        }
        close(fd[0]);ssize_t n=write(fd[1],message,strlen(message));if(n!=(ssize_t)strlen(message)) die("write");
        event("sent",",\"role\":\"parent\",\"write_bytes\":%ld,\"message\":\"%s\"",(long)n,message);close(fd[1]);
        int status;
        wait_child(child,&status);
        int code=WIFEXITED(status)?WEXITSTATUS(status):-1;
        event("summary",",\"child_pid\":%ld,\"exit_code\":%d,\"signal\":%d",(long)child,code,WIFSIGNALED(status)?WTERMSIG(status):0);
        return code==0?0:1;
    }
    if(!strcmp(mode,"eof") || !strcmp(mode,"eagain")){
        char c;ssize_t n;
        if(!strcmp(mode,"eagain")){
            int flags=fcntl(fd[0],F_GETFL);if(flags<0||fcntl(fd[0],F_SETFL,flags|O_NONBLOCK)) die("fcntl");
            errno=0;n=read(fd[0],&c,1);int saved=errno;
            event("empty_with_writer",",\"read_bytes\":%ld,\"errno\":%d",(long)n,saved);
            if(n!=-1||saved!=EAGAIN) return 1;
        }
        close(fd[1]);errno=0;n=read(fd[0],&c,1);int saved=errno;close(fd[0]);
        event("summary",",\"read_bytes\":%ld,\"errno\":%d,\"writers_remaining\":0",(long)n,saved);
        return n==0?0:1;
    }
    /* No process retains a read descriptor before the writer child starts. */
    close(fd[0]);pid_t child=fork();if(child<0) die("fork");
    if(!child){
        if(signal(SIGPIPE,!strcmp(mode,"epipe")?SIG_IGN:SIG_DFL)==SIG_ERR) die("signal");
        event("before_write",",\"role\":\"child\",\"readers_remaining\":0");
        errno=0;ssize_t n=write(fd[1],"x",1);int saved=errno;
        event("write_result",",\"role\":\"child\",\"write_bytes\":%ld,\"errno\":%d",(long)n,saved);close(fd[1]);
        _exit(!strcmp(mode,"epipe") && n==-1 && saved==EPIPE?0:1);
    }
    close(fd[1]);
    int status;
    wait_child(child,&status);
    int code=WIFEXITED(status)?WEXITSTATUS(status):-1,sig=WIFSIGNALED(status)?WTERMSIG(status):0;
    event("summary",",\"child_pid\":%ld,\"exit_code\":%d,\"signal\":%d",(long)child,code,sig);
    return !strcmp(mode,"epipe")?(code==0&&sig==0?0:1):(sig==SIGPIPE?0:1);
}
