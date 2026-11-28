#define _GNU_SOURCE
#include "../lab_common.h"
int main(int argc,char **argv) {
    if(argc!=5 || strcmp(argv[1],"course-demo")) return 2;
    int code=atoi(argv[2]),notify=atoi(argv[3]),release=atoi(argv[4]);
    event("after_exec",",\"role\":\"child\",\"ppid\":%ld,\"message\":\"course-demo\",\"requested_exit\":%d",(long)getppid(),code);
    send_byte(notify,'E');if(receive_byte(release)!='X') return 126;
    close(notify);close(release);
    return code;
}
