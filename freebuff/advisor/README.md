# Freebuff Advisor（旁路审查代理）

Freebuff 的旁路审查代理：主 agent 每轮 turn 结束后，Advisor 独立审查本轮新增消息并产出意见，经两条通道投递给主 agent。全程旁路——Advisor 的任何失败/延迟都不影响主流程。

## 能做什么

- **不打断通道**：意见挂在下一个 agent step 边界的 `drainSteeringMessages` 钩子上注入（作为 user prompt 追加，turn 继续），不中断当前工作
- **打断通道**：立即中止当前 run（abort），意见排到消息队列头最优先送达
- 增量审查：只审查自上次审查以来的新增消息（`lastAdvisorIndex` 基准线），避免重复成本
- 防环：意见注入前先推进基准线 + 注入消息带 `ADVISOR` 标记双重过滤，Advisor 意见不会被自己再审查

## 配置

文件：`~/.config/manicode[-<env>]/advisor.yml`（env 非 prod 时目录带后缀，与 CLI 配置目录一致）

```yaml
name: code-guardian        # 可选，默认 advisor
model: deepseek/deepseek-v4-pro  # 可选，默认 Freebuff 默认模型
allowedMethods: []         # 可选，工具白名单（映射为 advisor agent 的 toolNames；默认空=只读推理）
prompt: Review the recent conversation and file changes. # 可选，默认内置审查提示词
```

单 advisor（顶层必须是单个对象）。行为：

- 文件缺失 → Advisor 静默禁用（不影响主流程）
- YAML 非法 / 非对象 / 字段类型错误 → 禁用 + stderr/日志警告（warn），不阻塞
- 缺失字段 → 用默认值

## 通道细节

- **不打断**：`AdvisorRuntime.onTurnEnd(transcript)`（CLI 在 client.run resolve 后 fire-and-forget 调用）→ 增量消息喂 advisor（独立 agent 定义，`toolNames` 由 `allowedMethods` 映射，无 spawnableAgents）→ 意见入不打断队列 → 下一 step 边界经 `drainSteeringMessages` 注入
- **打断**：`AdvisorRuntime.interrupt(opinion)` 显式调用，或 advisor 意见文本以 `INTERRUPT:` 前缀开头（自动剥离前缀）→ abort 当前 run（reason `advisor-interrupt`）+ 意见排消息队列头
- 意见注入的消息带 `tags: ['ADVISOR']`，供防环过滤

## 已知限制

- **lastAdvisorIndex 跨会话延续**：advisor runtime 为进程级单例，`/new` 切换新会话后首次审查的 diff 基准可能错位（一期接受）
- 真实登录冒烟未做：advisor run 复用 CLI 的 CodebuffClient，需要登录凭据 + 可用后端才能真实跑通；单测用 mock run 覆盖编排逻辑
- advisor 意见未做 UI 呈现（气泡/面板），注入后以普通 user prompt 形态进入对话

## 来源

沿用 Freebuff ACP 模块的架构风格（注入 run 函数可测、纯新增模块）；Advisor 通道设计参照 OMP 的 WATCHDOG/advisor 思路，按简化规格实现（单 advisor、无 severity 分级/免疫窗口）。
