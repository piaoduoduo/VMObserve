#define _GNU_SOURCE
#include "../lab_common.h"
static int private_value=7;
int main(int argc,char **argv) {
    if(argc!=3 || (strcmp(argv[2],"normal")&&strcmp(argv[2],"exec-failure"))){
        fprintf(stderr,"usage: %s ./child_prog normal|exec-failure\n",argv[0]);return 2;
    }
    int ready[2],go[2];if(pipe(ready)||pipe(go)) die("pipe");
    event("begin",",\"lab\":\"4.1\",\"mode\":\"%s\",\"ppid\":%ld,\"value\":%d,\"address\":\"%p\"",argv[2],(long)getppid(),private_value,(void *)&private_value);
    pid_t child=fork();if(child<0) die("fork");
    if(child==0){
        close(ready[0]);close(go[1]);private_value=99;
        event("before_exec",",\"role\":\"child\",\"ppid\":%ld,\"fork_return\":0,\"value\":%d,\"address\":\"%p\"",(long)getppid(),private_value,(void *)&private_value);
        send_byte(ready[1],'B');if(receive_byte(go[0])!='G') _exit(126);
        char notify[32],release[32];snprintf(notify,sizeof notify,"%d",ready[1]);snprintf(release,sizeof release,"%d",go[0]);
        const char *program=!strcmp(argv[2],"normal")?argv[1]:"/vmobserve/nonexistent-child-for-exec-test";
        execl(program,"child_prog","course-demo","7",notify,release,(char *)NULL);
        int saved=errno;
        event("exec_error",",\"role\":\"child\",\"errno\":%d",saved);
        _exit(127);
    }
    close(ready[1]);close(go[0]);
    if(receive_byte(ready[0])!='B') die("child ready");
    event("parent_after_fork",",\"role\":\"parent\",\"child_pid\":%ld,\"fork_return\":%ld,\"value\":%d,\"address\":\"%p\"",(long)child,(long)child,private_value,(void *)&private_value);
    dump_status("before_exec",child,0);
    send_byte(go[1],'G');
    if(!strcmp(argv[2],"normal")){
        if(receive_byte(ready[0])!='E') die("exec ready");
        dump_status("after_exec",child,0);
        send_byte(go[1],'X');
    }
    close(ready[0]);close(go[1]);
    int status=wait_child(child);
    int code=WIFEXITED(status)?WEXITSTATUS(status):-1,signal=WIFSIGNALED(status)?WTERMSIG(status):0;
    event("summary",",\"role\":\"parent\",\"child_pid\":%ld,\"wait_return\":%ld,\"exit_code\":%d,\"signal\":%d,\"value\":%d",(long)child,(long)child,code,signal,private_value);
    return (signal==0 && code==(!strcmp(argv[2],"normal")?7:127) && private_value==7)?0:1;
}
