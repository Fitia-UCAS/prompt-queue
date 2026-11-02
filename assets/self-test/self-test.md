# 任务队列 Debug 自检

---

## User 1

我们一起排查一个任务队列的重复执行问题。接下来我会先给复现记录，再给源码和测试，最后核对一份候选补丁。六步都只处理这个问题。

先回复「准备好了」，等我发材料。

---

## ChatGPT 1

---

## User 2

### Attachments

- File · 01-issue.md · text/markdown

先看看问题说明，帮我确认每个任务实际和预期各执行了几次。源码下一步再发，先别急着猜原因。

---

## ChatGPT 2

---

## User 3

### Attachments

- File · 02-task-queue.cjs · application/javascript
- File · 03-retry-policy.cjs · application/javascript
- File · 04-task-queue.test.cjs · application/javascript

这是同一问题的队列实现、重试策略和测试。结合刚才的复现记录，逐步推演队列内容，找出多出来的那次执行是怎么产生的。指出对应的文件和代码，不要只说「有重复入队」。

---

## ChatGPT 3

---

## User 4

### Attachments

- File · 05-fix-requirements.md · text/markdown
- File · 06-task-queue.patch.cjs · application/javascript

现在对照修复要求审查这份候选补丁。逐项说明是否满足、依据是什么，并核对是否改变了重试顺序、次数和错误处理。能运行测试就实际运行；没有执行环境就明确写出「未运行」，不要把推演当成测试结果。

---

## ChatGPT 4

---

## User 5

不用再读取附件。把这次排查收敛成一份简短的修复说明：根因、最小修改、回归测试。补丁用 unified diff 表示，只保留解决这个问题所需的修改。

---

## ChatGPT 5

---

## User 6

最后复核一遍：原来的重复执行能否由现有代码和复现记录解释，修复是否覆盖了重试上限、非临时错误和并行 drain。说明哪些结论已经验证、哪些仍是静态判断；如果有材料没有读完整，也直接指出。确认后回复「自检完成」。

---

## ChatGPT 6
