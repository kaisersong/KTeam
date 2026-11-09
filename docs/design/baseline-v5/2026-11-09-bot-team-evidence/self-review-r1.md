# Codex 作者自审 R1

候选 SHA256：4279fc4c61c8dd23eb8bc78881140c3b97b28667b503e743747af057314055de。

结论 REVISE，非实现批准。

- SELF-01 P2：第13节只有“唯一writer”原则，未指定现有Room消息、KSwarm Agent与新Bot目录的canonical owner，容易再建转录和双目录。补对象owner表、旧ID映射、旧Main→后台服务切换/回滚与客户端兼容门槛。
- SELF-02 P2：绑定外部CLI虽写服务校验，CLI本身绕过宿主直接读写/联网时的约束证据不足。明确自动执行资格取决于实际可执行的权限收窄和子进程跟踪；不具备约束只讨论/不可用，不以--plan当沙箱。
- SELF-03 P2：read cursor未规定窗口前台/消息可见，可能在后台或重连时误读。补实际可见及显式“全部已读”，私聊/群独立cursor，系统通知不改变read。
- SELF-04 P2：周期research与已有承诺默认主动的权限区分正确，但单次follow-up缺最大pending/daily/时间范围，以及Agent不可取消user-created routine。补可配置硬上限与source/ownership服务校验、Hide/snooze用户偏好不被默认策略复活。
- SELF-05 P2：声明撤销后摘要也不可见，却没有已显示/已导出内容边界。补未来投影/输入/导出遵守依赖失效，历史占位/审计；不能承诺收回人已看见或已导出的内容。
- SELF-06 非阻断：Bot身份、运行结束、交付提交、验收通过须在例子与成功门槛中使用同一语义，不允许manifest unverified映射为目标完成。

下一轮将上述问题与外部真实CLI结果一起处置，不靠本作者意见冒充四方一致。
