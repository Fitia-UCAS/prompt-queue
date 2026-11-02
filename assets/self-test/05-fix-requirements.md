# 修复要求

1. 保留 createQueue、add、drain 的接口，不改调用方来绕过问题。
2. 一次失败只允许产生一次重试入队，不得用去重日志掩盖重复执行。
3. maxAttempts 包含首次执行。设为 2 时，持续失败的任务最多执行两次，随后把错误交给调用方。
4. 只有 E_TEMP 可以重试，其余错误直接返回给调用方。
5. 重试放到队尾；job-A 失败后，已排队的 job-B 应先于 job-A 的重试执行。
6. 同时调用两次 drain 不得产生并行执行循环。异常退出后仍应释放 draining 状态。

验收命令：

~~~sh
node 04-task-queue.test.cjs ./06-task-queue.patch.cjs
~~~

预期输出为「4 cases passed」。这个结果需要实际运行才能确认；静态阅读时应分别说明判断依据和未执行部分。
