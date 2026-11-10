# 统一运行入口（v0.1.0）

本说明替代最初的预实验运行步骤。原始 results 和 guest-runs 全部保留；不要移动项目或虚拟磁盘。脚本路径已改为相对自身定位，但 qcow2 写入层仍可能记录绝对 backing 路径。

## Windows

在项目根目录：

```powershell
./work/vm.ps1 status
./work/vm.ps1 start
./work/vm.ps1 wait
./work/vm.ps1 retest
python work/launch.py
```

浏览器打开 http://127.0.0.1:8765 。默认目标是已有 openEuler VM。关闭服务用 Ctrl+C，先等运行任务结束。若端口已占用，用 `python work/launch.py --port 8766`，不要杀不认识的占用进程。

PowerShell 入口用 wslpath 转换实际项目路径，不再要求手写 /mnt/d/...；默认发行版 Ubuntu。VM 配置集中在 `openeuler-vm/config.sh`，端口 2226，密钥默认 `/root/proj5-vm/id_ed25519`。可覆盖 PROJ5_VM_PORT、PROJ5_VM_STATE_DIR、PROJ5_VM_KEY；现有 VM 已运行时不改变其参数。

## Linux

```sh
python3 work/run_all.py
python3 work/run_all.py --require-openeuler
python3 work/run_all.py --suite thp --pattern sparse --thp both --repeats 3
python3 work/run_all.py --recheck-from work/runs/某次运行ID
python3 work/launch.py --executor local
```

基础实验默认 16/64 MiB 各 3 次；THP 四条件各 3 次。参数：suite=all/baseline/thp，pattern=all/sparse/full，thp=both/on/off，repeats=1..5，timeout=(0,120] 秒。默认每次程序 20 秒、编译 30 秒。THP 开关顺序交替。

旧 `run_pilot.py` 与 `run_thp.py` 自动转入统一运行器，并生成独立 `work/runs/<ID>`，不再覆盖旧 results。

## 回放与导出

```sh
cd work
python3 -m vmobserve replay openeuler-vm/guest-runs/20261110T091621.439041Z
python3 -m vmobserve export openeuler-vm/guest-runs/20261110T091621.439041Z --output ../output/example-export
```

输出为 HTML、JSON、CSV。无需 Linux 或 GCC即可回放。旧格式只进行部分来源校验；新格式重新核对源码和原始数据 SHA256，重新计算诊断，不执行保存的源码。

## 每轮证据

`report.json` 保存 schema、环境、计划、状态、校验、诊断和来源；`environment.json` 是独立环境记录；`source/` 为源码快照；`build/` 为编译版本和日志；`cases/<ID>/` 为原始 stdout.jsonl 与 smaps.stderr.txt。失败也有报告（进程强杀或存储故障可能只剩最后检查点）。

VM 传输日志在 `openeuler-vm/transfers/<宿主ID>`，只打包白名单源码，每次上传到新的客体目录。普通重跑不安装依赖。runner 非零退出后仍取回本轮 runs，禁止覆盖已有 guest-runs。传输脚本拥有输出目录，不接受 --output；用 --suite/--repeats 等选择实验。

退出码 0=完成，1=失败，2=不支持/参数错误，3=完成但偏离预期，130=中断。completed 不保证大页实际生效；以 AnonHugePages 与对照为准。

## 目标系统与限制

现有环境为 openEuler 24.03 LTS、内核 6.6.0-28.0.0.34.oe2403.x86_64，QEMU TCG 2 核/2 GiB；SSH 仅 WSL 127.0.0.1:2226。`--require-openeuler` 同时拒绝非 openEuler 用户态和 Microsoft/WSL 内核。默认不改全局 THP。

客体时钟与宿主有约 51 分钟偏差（本轮实际观测；可能变化）。没有为了隐藏警告而修改时间；源码包的 mtime 归一化为 0，内容 SHA256 不变。运行身份依靠唯一 ID 与哈希；传输日志保留两侧时间，不能跨机器直接按 ID推断先后。

历史初始复测在 guest-runs/20261110T091621.439041Z。当前验证入口与新增证据见 ../docs/VERIFICATION.md；后续接手先看 ../docs/HANDOFF.md。
