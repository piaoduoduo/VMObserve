#define _GNU_SOURCE
#include <pthread.h>
#include "../lab_common.h"
typedef struct {int balance;pthread_mutex_t lock;pthread_cond_t cond;} Account;
static Account accounts[5];
static volatile int unsafe_balance;
static pthread_barrier_t start;
static pthread_cond_t waiting=PTHREAD_COND_INITIALIZER;
static int waiters;
static void barrier(void) {int n=pthread_barrier_wait(&start);if(n&&n!=PTHREAD_BARRIER_SERIAL_THREAD)check_pthread(n,"barrier");}
struct deposit_arg {int id,locked;};
static void *deposit_many(void *argument) {
    struct deposit_arg *a=argument;Account *acc=&accounts[0];
    event("deposit_worker",",\"worker\":%d,\"variant\":\"%s\"",a->id,a->locked?"mutex":"unsafe");barrier();
    for(int i=0;i<50000;++i){
        if(a->locked){PT(pthread_mutex_lock(&acc->lock));acc->balance+=1;PT(pthread_mutex_unlock(&acc->lock));}
        else unsafe_balance+=1;
    }
    return NULL;
}
static int comparison(void) {
    for(int locked=0;locked<=1;++locked){
        pthread_t threads[2];struct deposit_arg args[]={{1,locked},{2,locked}};
        PT(pthread_barrier_init(&start,NULL,3));
        for(int i=0;i<2;++i) PT(pthread_create(&threads[i],NULL,deposit_many,&args[i]));
        barrier();for(int i=0;i<2;++i) PT(pthread_join(threads[i],NULL));PT(pthread_barrier_destroy(&start));
        event("counter_result",",\"variant\":\"%s\",\"value\":%d,\"expected\":100000",locked?"mutex":"unsafe",locked?accounts[0].balance:unsafe_balance);
    }
    event("summary",",\"value\":%d,\"expected\":100000,\"unsafe_value\":%d",accounts[0].balance,unsafe_balance);
    return accounts[0].balance==100000?0:1;
}
struct withdrawal {int id,amount;};
static void *withdraw_wait(void *argument) {
    struct withdrawal *a=argument;Account *acc=&accounts[1];int announced=0;
    PT(pthread_mutex_lock(&acc->lock));
    while(acc->balance<a->amount){
        if(!announced){++waiters;announced=1;}
        event("waiting",",\"worker\":%d,\"amount\":%d,\"balance\":%d",a->id,a->amount,acc->balance);
        PT(pthread_cond_broadcast(&waiting));
        PT(pthread_cond_wait(&acc->cond,&acc->lock));
    }
    acc->balance-=a->amount;
    event("withdrawn",",\"worker\":%d,\"amount\":%d,\"balance\":%d",a->id,a->amount,acc->balance);
    PT(pthread_mutex_unlock(&acc->lock));return NULL;
}
static void *deposit_notify(void *unused) {
    (void)unused;Account *acc=&accounts[1];PT(pthread_mutex_lock(&acc->lock));
    /* A handshake observes both waiters; no sleep is used to guess scheduling. */
    while(waiters<2) PT(pthread_cond_wait(&waiting,&acc->lock));
    acc->balance+=200;event("deposited",",\"amount\":200,\"balance\":%d,\"waiters\":%d",acc->balance,waiters);
    PT(pthread_cond_broadcast(&acc->cond));PT(pthread_mutex_unlock(&acc->lock));return NULL;
}
static int condition_demo(void) {
    accounts[1].balance=30;struct withdrawal args[]={{1,80},{2,50}};pthread_t threads[3];
    for(int i=0;i<2;++i) PT(pthread_create(&threads[i],NULL,withdraw_wait,&args[i]));
    PT(pthread_create(&threads[2],NULL,deposit_notify,NULL));
    for(int i=0;i<3;++i) PT(pthread_join(threads[i],NULL));
    event("summary",",\"value\":%d,\"expected\":100,\"waiters\":%d",accounts[1].balance,waiters);
    return accounts[1].balance==100 && waiters==2?0:1;
}
struct transfer_arg {int from,to,amount,id,times,success;};
static void *transfer_thread(void *argument) {
    struct transfer_arg *a=argument;int first=a->from<a->to?a->from:a->to,second=a->from+a->to-first;
    barrier();
    for(int i=0;i<a->times;++i){
        PT(pthread_mutex_lock(&accounts[first].lock));PT(pthread_mutex_lock(&accounts[second].lock));
        if(accounts[a->from].balance>=a->amount){
            accounts[a->from].balance-=a->amount;accounts[a->to].balance+=a->amount;++a->success;
            event("transferred",",\"worker\":%d,\"from\":%d,\"to\":%d,\"amount\":%d,\"first_lock\":%d,\"second_lock\":%d,\"from_balance\":%d,\"to_balance\":%d",a->id,a->from,a->to,a->amount,first,second,accounts[a->from].balance,accounts[a->to].balance);
        } else event("insufficient_balance",",\"worker\":%d",a->id);
        PT(pthread_mutex_unlock(&accounts[second].lock));PT(pthread_mutex_unlock(&accounts[first].lock));
    }
    return NULL;
}
static int transfers(void) {
    for(int i=2;i<=4;++i) accounts[i].balance=1000;
    struct transfer_arg args[]={{2,3,10,1,20,0},{3,2,10,2,20,0},{2,4,20,3,10,0},{4,3,15,4,10,0}};
    pthread_t threads[4];PT(pthread_barrier_init(&start,NULL,5));
    for(int i=0;i<4;++i) PT(pthread_create(&threads[i],NULL,transfer_thread,&args[i]));
    barrier();int success=0;
    for(int i=0;i<4;++i){PT(pthread_join(threads[i],NULL));success+=args[i].success;}
    PT(pthread_barrier_destroy(&start));
    int total=accounts[2].balance+accounts[3].balance+accounts[4].balance;
    event("summary",",\"value\":%d,\"expected\":3000,\"success\":%d,\"account2\":%d,\"account3\":%d,\"account4\":%d",total,success,accounts[2].balance,accounts[3].balance,accounts[4].balance);
    return total==3000 && success==60 && accounts[2].balance==800 && accounts[3].balance==1150 && accounts[4].balance==1050?0:1;
}
int main(int argc,char **argv) {
    if(argc!=2 || (strcmp(argv[1],"comparison")&&strcmp(argv[1],"condition")&&strcmp(argv[1],"transfer"))) return 2;
    for(int i=0;i<5;++i){PT(pthread_mutex_init(&accounts[i].lock,NULL));PT(pthread_cond_init(&accounts[i].cond,NULL));}
    event("begin",",\"lab\":\"4.4-bank\",\"mode\":\"%s\"",argv[1]);
    int code=!strcmp(argv[1],"comparison")?comparison():!strcmp(argv[1],"condition")?condition_demo():transfers();
    for(int i=0;i<5;++i){PT(pthread_mutex_destroy(&accounts[i].lock));PT(pthread_cond_destroy(&accounts[i].cond));}
    PT(pthread_cond_destroy(&waiting));return code;
}
