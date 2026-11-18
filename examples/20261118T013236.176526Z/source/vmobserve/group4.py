"""Process/thread course labs; replay events without inventing memory metrics."""
import re
from pathlib import Path

SOURCES = {"g4-fork":"course-labs/group4/lab4_1/fork_exec_wait.c",
           "g4-pthread":"course-labs/group4/lab4_2/pthread_test.c",
           "g4-uthread":"course-labs/group4/lab4_3/user_thread_test.c",
           "g4-pipe":"course-labs/group4/lab4_4/pipe_communication.c",
           "g4-bank":"course-labs/group4/lab4_4/thread_communication.c"}
MODES = {"g4-fork":("normal","exec-failure"), "g4-pthread":("unsafe","mutex"),
         "g4-uthread":("round-robin","blocking"), "g4-pipe":("basic","eof","eagain","epipe","sigpipe"),
         "g4-bank":("comparison","condition","transfer")}
LABS = {"g4-fork":"4.1","g4-pthread":"4.2","g4-uthread":"4.3","g4-pipe":"4.4-pipe","g4-bank":"4.4-bank"}
TITLES={"g4-fork":"4.1 创建、替换与等待进程","g4-pthread":"4.2 内核线程与共享变量",
        "g4-uthread":"4.3 用户态调度与独立栈","g4-pipe":"4.4 管道端点与字节流","g4-bank":"4.4 共享账户的互斥与同步"}


def plan(repeats, task="all"):
    return [dict(id=f"{suite}-{mode}-{repeat}",suite=suite,parameters={"mode":mode,"repeat":repeat},arguments=[mode])
            for suite,modes in MODES.items() if task=="all" or LABS[suite].startswith(task)
            for mode in modes for repeat in range(1,repeats+1)]


def build_child(out, compiler, execute):
    return execute([compiler,"-std=gnu11","-O2","-g","-Wall","-Wextra","-Werror",
                    str(out/"source/course-labs/group4/lab4_1/child_prog.c"),"-o",str(out/"build/child_prog")],
                   out/"build/child_prog.stdout.log",out/"build/child_prog.stderr.log",30)


def command(case, binary):
    return [str(binary), *([str(binary.parent/"child_prog")] if case["suite"]=="g4-fork" else []), *case["arguments"]]


def one(rows, name):
    matches=[r for r in rows if r["event"]==name]
    if len(matches)!=1: raise ValueError(f"expected one {name}, got {len(matches)}")
    return matches[0]


def parse(records, raw, suite, parameters):
    if not records or any(r.get("kind")!="event" or not isinstance(r.get("event"),str) for r in records):
        raise ValueError("invalid process/thread event stream")
    begin,summary=one(records,"begin"),one(records,"summary")
    if records[0]!=begin or records[-1]!=summary or begin["mode"]!=parameters["mode"] or begin["lab"]!=LABS[suite]:
        raise ValueError("event stream differs from execution plan")
    if parameters["mode"] not in MODES[suite]: raise ValueError("unknown group4 mode")
    for r in records:
        if any(type(r.get(k)) is not int or r[k]<=0 for k in ("pid","tid","time_ns")):
            raise ValueError("missing event PID/TID/time")
    status={}
    for tag,pid,body in re.findall(r"BEGIN status=(\S+) pid=(\d+)\n(.*?)\nEND status",raw,re.S):
        values=dict(re.findall(r"^(Name|Pid|Tgid|PPid|Threads):\s+([^\n]+)$",body,re.M))
        if set(values)!={"Name","Pid","Tgid","PPid","Threads"} or int(values["Pid"])!=int(pid):
            raise ValueError("incomplete /proc status evidence")
        if tag in status: raise ValueError("duplicate kernel status block")
        status[tag]={k:(v if k=="Name" else int(v)) for k,v in values.items()}
    ps_threads=[tuple(map(int,m)) for m in re.findall(r"^\s*(\d+)\s+(\d+)\s+(\d+)\s+\S+\s+\S+\s*$",raw,re.M)]
    required={"g4-fork":("before_exec","after_exec") if parameters["mode"]=="normal" else ("before_exec",),
              "g4-pthread":("pthread_ready",),"g4-uthread":("uthread_ready",)}.get(suite,())
    if any(tag not in status for tag in required): raise ValueError("kernel observation missing")
    return {"condition":begin,"summary":summary,"kernel_status":status,"ps_threads":ps_threads,
            "samples":[dict(r,phase=r["event"],role=r.get("role","process"),scope="process_thread_event") for r in records]}


def validate(suite,data):
    rows=data["samples"];begin=data["condition"];summary=data["summary"];mode=begin["mode"];checks=[]
    def check(name,observed,expected):
        checks.append(dict(id=name,observed=observed,expected=expected,category="correctness",
                           status="passed" if observed==expected else "failed"))
    def all_events(name): return [r for r in rows if r["event"]==name]
    def event(name): return one(rows,name)
    check("parent_summary",summary["pid"],begin["pid"])
    if suite=="g4-fork":
        child=event("before_exec");parent=event("parent_after_fork");cid=child["pid"]
        check("fork_child_return",child["fork_return"],0)
        check("fork_parent_return",parent["fork_return"],cid)
        check("child_parent",child["ppid"],begin["pid"])
        check("waited_child",summary["wait_return"],cid)
        check("private_parent_value",[parent["value"],summary["value"]],[7,7])
        check("private_child_value",child["value"],99)
        check("same_virtual_address",parent["address"],child["address"])
        check("kernel_child_identity",[data["kernel_status"]["before_exec"]["Pid"],data["kernel_status"]["before_exec"]["PPid"]],[cid,begin["pid"]])
        check("signal",summary["signal"],0)
        if mode=="normal":
            after=event("after_exec");check("exec_preserves_pid",after["pid"],cid)
            check("exec_argument",after["message"],"course-demo")
            check("exec_exit",summary["exit_code"],7)
            check("new_process_image",data["kernel_status"]["after_exec"]["Name"],"child_prog")
            check("kernel_post_exec_identity",data["kernel_status"]["after_exec"]["Pid"],cid)
            check("success_does_not_return",len(all_events("exec_error")),0)
        else:
            check("exec_failure_errno",event("exec_error")["errno"],2)
            check("exec_failure_exit",summary["exit_code"],127)
            check("no_new_image",len(all_events("after_exec")),0)
    elif suite=="g4-pthread":
        starts=all_events("worker_start");ends=all_events("worker_end")
        check("two_workers",sorted(r["worker"] for r in starts),[1,2])
        check("workers_joined",sorted(r["worker"] for r in ends),[1,2])
        check("one_process",sorted({r["pid"] for r in rows}),[begin["pid"]])
        check("different_kernel_threads",len({r["tid"] for r in starts}|{begin["tid"]}),3)
        check("global_shared",all(r["address"]==begin["address"] for r in starts),True)
        check("heap_shared",all(r["heap_address"]==begin["heap_address"] for r in starts),True)
        check("separate_stacks",len({r["stack_address"] for r in starts}),2)
        check("kernel_threads",data["kernel_status"]["pthread_ready"]["Threads"],3)
        check("ps_matches_worker_tids",{r["tid"] for r in starts}.issubset({tid for pid,ppid,tid in data["ps_threads"] if pid==begin["pid"]}),True)
        check("requested_work",summary["expected"],2000000)
        if mode=="mutex":check("protected_counter",summary["value"],2000000)
    elif suite=="g4-uthread":
        created=all_events("created");steps=all_events("step")
        check("three_contexts",sorted(r["worker"] for r in created),[0,1,2])
        check("round_robin_steps",[(r["worker"],r["step"]) for r in steps],[(i,j) for j in range(1,4) for i in range(3)])
        check("all_finished",sorted(r["worker"] for r in all_events("finished")),[0,1,2])
        check("one_kernel_thread",{(r["pid"],r["tid"]) for r in rows}=={(begin["pid"],begin["tid"])},True)
        check("kernel_thread_count",data["kernel_status"]["uthread_ready"]["Threads"],1)
        ranges={r["worker"]:(int(r["stack_base"],16),r["stack_bytes"]) for r in created}
        spans=sorted((start,start+size) for start,size in ranges.values())
        check("independent_stacks",len(spans)==3 and all(a[1]<=b[0] for a,b in zip(spans,spans[1:])),True)
        check("locals_on_own_stacks",all(ranges[r["worker"]][0]<=int(r["stack_address"],16)<sum(ranges[r["worker"]]) for r in steps),True)
        check("scheduler_return",summary["value"],3)
        if mode=="blocking":
            a,b=event("block_begin"),event("block_end")
            check("blocking_observed",b["time_ns"]-a["time_ns"]>=150000000,True)
            i,j=rows.index(a),rows.index(b)
            check("no_other_context_during_block",j,i+1)
    elif suite=="g4-pipe":
        if mode=="basic":
            sent,got=event("sent"),event("received")
            check("bytes_preserved",got["message"],"Hello from Parent Process!")
            check("byte_count",[sent["write_bytes"],got["read_bytes"]],[26,26])
            check("receiver_process",got["pid"],summary["child_pid"])
            check("sender_parent",sent["pid"],begin["pid"])
            check("eof_after_payload",got["eof"],True)
            check("child_exit",[summary["exit_code"],summary["signal"]],[0,0])
        elif mode in ("eof","eagain"):
            check("all_writers_closed",summary["writers_remaining"],0)
            check("read_eof",summary["read_bytes"],0)
            if mode=="eagain":check("empty_with_writer",[event("empty_with_writer")["read_bytes"],event("empty_with_writer")["errno"]],[-1,11])
        elif mode=="epipe":
            check("ignored_sigpipe_epipe",[event("write_result")["write_bytes"],event("write_result")["errno"]],[-1,32])
            check("writer_survived",[summary["exit_code"],summary["signal"]],[0,0])
        else:
            check("default_sigpipe",summary["signal"],13)
            check("no_successful_write",len(all_events("write_result")),0)
    elif suite=="g4-bank":
        if mode=="comparison":
            results=all_events("counter_result");check("both_variants",[r["variant"] for r in results],["unsafe","mutex"])
            check("safe_deposits",summary["value"],100000)
            check("safe_detail",next(r for r in results if r["variant"]=="mutex")["value"],100000)
        elif mode=="condition":
            deposit=event("deposited");withdrawals=all_events("withdrawn");waiting=all_events("waiting")
            check("two_waiters",{r["worker"] for r in waiting}=={1,2},True)
            check("wait_before_deposit",all(rows.index(r)<rows.index(deposit) for r in waiting),True)
            check("deposit_balance",deposit["balance"],230)
            check("withdraw_amounts",sorted(r["amount"] for r in withdrawals),[50,80])
            balance=230
            for r in withdrawals:
                balance-=r["amount"];check("withdraw_balance_"+str(r["worker"]),r["balance"],balance)
            check("final_balance",summary["value"],100)
        else:
            transfers=all_events("transferred");check("transfers_complete",len(transfers),60)
            check("ordered_locks",all(r["first_lock"]<r["second_lock"] and {r["first_lock"],r["second_lock"]}=={r["from"],r["to"]} for r in transfers),True)
            ledger={2:1000,3:1000,4:1000};consistent=True
            for r in transfers:
                ledger[r["from"]]-=r["amount"];ledger[r["to"]]+=r["amount"]
                consistent &= ledger[r["from"]]==r["from_balance"] and ledger[r["to"]]==r["to_balance"] and min(ledger.values())>=0
            check("event_ledger",consistent,True)
            check("final_accounts",[summary["account2"],summary["account3"],summary["account4"]],[800,1150,1050])
            check("conserved_total",summary["value"],3000)
            check("successful_operations",summary["success"],60)
    return {"status":"passed" if all(r["status"]=="passed" for r in checks) else "failed","checks":checks,
            "scope":"collection and protected/reference outcomes; intentional unsafe variants are observations"}


def findings(case):
    d=case["data"];mode=d["condition"]["mode"];suite=case["suite"];s=d["summary"]
    if suite=="g4-fork":text=f"子进程{ s['child_pid'] }由waitpid回收，退出码{s['exit_code']}；父进程私有变量保持{s['value']}。成功exec前后PID相同，程序映像改变。" if mode=="normal" else "exec失败返回ENOENT，子进程以127退出，父进程取得该状态。"
    elif suite=="g4-pthread":text=f"两个工作线程共享PID和全局/堆地址，内核TID与栈地址不同。{mode}最终计数{s['value']}，串行期望{s['expected']}。"
    elif suite=="g4-uthread":text="三个独立用户栈在同一内核线程中轮转；九步和三次结束均已记录。"+("阻塞调用期间没有其他用户线程推进。" if mode=="blocking" else "")
    elif suite=="g4-pipe":text={"basic":"26字节字符串完整传递；分段read后收到EOF。","eof":"所有写端关闭后read返回0。","eagain":"空管道有写端时非阻塞read为EAGAIN；写端全部关闭后为EOF。","epipe":"忽略SIGPIPE后write返回-1/EPIPE，进程继续执行。","sigpipe":"默认SIGPIPE终止写进程，监控父进程记录信号13。"}[mode]
    else:text={"comparison":f"无锁余额{s.get('unsafe_value')}；互斥版余额{s['value']}（期望100000）。","condition":"两个取款线程先等待，存入200后唤醒；30+200−80−50=100。","transfer":"60次转账按账户ID顺序加锁，逐笔账目一致，总额保持3000。"}[mode]
    limit="无锁版本有C数据竞争，输出用于观察；一次恰好正确不说明同步正确。" if suite=="g4-pthread" or (suite=="g4-bank" and mode=="comparison") else "此处验证进程、调度和同步行为；性能与物理页复制数量未测量。"
    return [dict(rule="group4",confidence="confirmed",title=TITLES[suite],explanation=text,limitations=limit,
                 evidence=[{"case_id":case["id"],"artifacts":case["artifacts"],"summary":s}],
                 next_steps=["先说明本案例的预期，再对照原始事件；fork私有地址可联系已有COW实验，pthread共享地址可联系第3组映射。"])]
