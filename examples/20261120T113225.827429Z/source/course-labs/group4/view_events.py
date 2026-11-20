"""Readable console view; the shell tee retains the unchanged JSONL records."""
import json,sys
labels={'begin':'开始','before_exec':'exec前的子进程','parent_after_fork':'fork后的父进程',
        'after_exec':'新程序child_prog','exec_error':'exec失败返回','summary':'本轮结果',
        'worker_start':'线程启动','worker_end':'线程结束','created':'创建用户线程',
        'dispatch':'调度到','step':'用户线程运行','finished':'用户线程结束',
        'block_begin':'开始阻塞','block_end':'阻塞返回','sent':'发送','received':'接收',
        'empty_with_writer':'空管道仍有写端','before_write':'所有读端关闭后写入',
        'write_result':'写入返回','deposit_worker':'存款线程','counter_result':'计数对照',
        'waiting':'余额不足，等待','deposited':'存款并通知','withdrawn':'取款成功','transferred':'转账成功'}
for line in sys.stdin:
    row=json.loads(line)
    name=row.pop('event');row.pop('kind');row.pop('time_ns')
    print(labels.get(name,name)+' | '+' '.join(f'{key}={value}' for key,value in row.items()),flush=True)
