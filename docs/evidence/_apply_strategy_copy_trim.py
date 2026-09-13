# -*- coding: utf-8 -*-
"""清理策略页的冗余说明文案（纯 `client/**`）。

判据：用户反馈「太多无用的文字说明」。本脚本按「逐条可回指」的方式删除/压缩，
每条替换**必须恰好命中 1 次**（0 次 = 原文已变，报错退出，绝不静默 no-op）。

不删的东西（红线）：
  - 后端契约的**硬事实**（如「窗口须落在数据集窗口内」「保存时后端校验存在且 READY」）；
  - 失败/阻塞的**真实原因**（BLOCKED 语义、真实写库警告）；
  - 任何 `data-*` / `aria-*` / 端点名 / 字段名。
改的都是「解释性长句」：同义反复的副标题、把常识说一遍的提示。
"""
import io
import os
import sys

ROOT = r"C:\work\sourcecode\stock-limit-up-analyzer"
C = r"client\src\components\strategy"


def p(*parts):
    return os.path.join(ROOT, *parts)


GROUPS = []


def group(path, pairs):
    GROUPS.append((path, pairs))


# ---------------------------------------------------------------------------
# 1. RunConfigPanel —— 全页文案最重的一处（219 字长文案）
# ---------------------------------------------------------------------------
group(p(C, "RunConfigPanel.tsx"), [
    # ① 副标题是流程同义反复
    (
        '      title="回测配置"\n      description="策略 → 数据集 → 回测配置 → 运行 → 结果"\n',
        '      title="回测配置"\n',
    ),
    # ② 前置检查：保留「必填 / 坐标不全 / 未绑定」三个硬事实，去掉解释
    (
        '    return "时间范围（起始 / 结束）都是必填 —— 后端契约要求非空日期，留空会被直接拒绝。已预置默认窗口，请确认或修改后再运行。";',
        '    return "时间范围必填。";',
    ),
    (
        '    return "策略坐标不完整（strategyId / version 缺失）—— 请先「加载」或「保存」一个真实落库的策略版本再运行。";',
        '    return "策略尚未落库（缺 strategyId / version），先「保存」再运行。";',
    ),
    (
        '    return "本策略未绑定 Dataset Registry 版本（datasetVersionId 为空）—— 运行需要该坐标才能读到真实数据集，请先在策略编辑器绑定数据集。";',
        '    return "未绑定数据集版本 —— 先在「策略定义 → 基础信息」里选一个 READY 版本。";',
    ),
    # ③ 按钮 Tooltip：三处长句 → 短句
    (
        '  const tooltip = !wired\n'
        '    ? "运行端点未接线（本页未注入 onRun）"\n'
        '    : running\n'
        '      ? "正在执行闭环运行…"\n'
        '      : reasonHint\n'
        '        ? `点击执行：入参齐备的阶段会真实运行；不可执行阶段将如实 BLOCKED。当前首因：${reasonHint}`\n'
        '        : "点击执行闭环运行（真实调用封闭循环编排器）";',
        '  const tooltip = !wired\n'
        '    ? "运行入口未接线"\n'
        '    : running\n'
        '      ? "正在运行…"\n'
        '      : reasonHint\n'
        '        ? `入参齐备的阶段真跑，其余如实标为 BLOCKED。首因：${reasonHint}`\n'
        '        : "运行闭环（读取真实数据）";',
    ),
    # ④ 就绪探测
    (
        '          <p className="text-xs text-muted-foreground">正在探测运行就绪状态…</p>',
        '          <p className="text-xs text-muted-foreground">探测就绪状态…</p>',
    ),
    (
        '          <ShieldCheck className="h-3.5 w-3.5" />\n          数据域已认证、策略已注册、执行器已绑定 —— 可发起研究 run。',
        '          <ShieldCheck className="h-3.5 w-3.5" />\n          就绪，可运行。',
    ),
    # ⑤ 日期窗口提示：保留「必须落在窗口内」这个硬事实与具体边界
    (
        '            <p className="text-[11px] leading-relaxed text-muted-foreground">\n'
        '              两格必填，且窗口须落在数据集窗口\n'
        '              （<code className="font-mono">2024-09-01 ~ 2026-09-01</code>）内；\n'
        '              越界会被后端直接拒绝。\n'
        '            </p>',
        '            <p className="text-[11px] leading-relaxed text-muted-foreground">\n'
        '              两格必填，且须落在 <code className="font-mono">2024-09-01 ~ 2026-09-01</code> 内。\n'
        '            </p>',
    ),
    # ⑥ 态势区：两段长解释 → 一段，保留「未装配执行器的阶段会 BLOCKED」这个诚实边界
    (
        '        <p className="text-[11px] leading-relaxed text-muted-foreground">\n'
        '          服务端按时间范围读取该策略绑定的数据集（{bound}）、读取已达库的策略文档，\n'
        '          并按执行配方装配入参 —— data / research / strategy / backtest / evaluation\n'
        '          五个阶段真的会跑。数据集的就绪状态取自库内的真实状态，不由本页开关决定。\n'
        '        </p>\n'
        '        <p className="text-[11px] leading-relaxed text-muted-foreground">\n'
        '          未装配执行器的阶段（optimization / robustness / oos / overfitting / paper /\n'
        '          review / discipline）会如实标记为 BLOCKED —— 这是当前实现边界，不是本次运行的错误。\n'
        '        </p>',
        '        <p className="text-[11px] leading-relaxed text-muted-foreground">\n'
        '          按时间范围读取该策略绑定的数据集（{bound}）与已落库策略文档，再按配方装配入参；\n'
        '          未装配执行器的阶段会如实标为 BLOCKED —— 是实现边界，不是本次运行的错误。\n'
        '        </p>',
    ),
    # ⑦ 前置检查横幅：去掉「尚未发起运行」这句废话（用户刚点了按钮，他知道）
    (
        '            <span>\n'
        '              <b>尚未发起运行</b>：{precheckError}\n'
        '            </span>',
        '            <span>{precheckError}</span>',
    ),
    # ⑧ 配方提示
    (
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            策略文档里写了 <code className="font-mono">recipe</code> 时以文档为准；\n'
        '            没写时用此处的值。实际用了哪个会显示在结果里。\n'
        '          </p>',
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            文档里有 <code className="font-mono">recipe</code> 时以文档为准；实际用了哪个会显示在结果里。\n'
        '          </p>',
    ),
])

# ---------------------------------------------------------------------------
# 2. ClosedLoopRunResultPanel —— 顺带修掉两条**已失效**的原因说明
#    （原文还在说「未开启使用真实数据」「未勾选数据完整性」，而这两个开关
#      已在 2026-09-13 从 UI 移除 ⇒ 属于会误导人的过期文案）
# ---------------------------------------------------------------------------
group(p(C, "ClosedLoopRunResultPanel.tsx"), [
    (
        'const BLOCKED_REASON_HUMAN: Readonly<Record<string, string>> = {\n'
        '  CL_DATA_NOT_INJECTED:\n'
        '    "本次没有注入真实数据集（未开启「使用真实数据」）→ 后续所有阶段无法获得数据，故全部阻塞。开启后重跑即可。",\n'
        '  CL_DATASET_GATE_NOT_PASS:\n'
        '    "数据集预检未通过（通常是「数据完整性已确认」未勾选，预检恒为 INCONCLUSIVE）→ 数据阶段如实阻塞。勾选后重跑即可。",\n'
        '  CL_RUNNER_NOT_INJECTED:\n'
        '    "该阶段尚无真实执行器（未装配），因此无法执行 → 其下游阶段按编排器规则一并阻塞。属功能未覆盖，非运行错误。",\n'
        '  CL_UPSTREAM_BLOCKED:\n'
        '    "上游阶段阻塞（任一阶段阻塞则其后继全部阻塞，禁止伪造中间产物）→ 需先解决上游问题。",\n'
        '  CL_WIRING_ARTIFACT_MISSING:\n'
        '    "装配层缺少该阶段所需的重对象（旁路产物）→ 装配不完整，属配置问题。",\n'
        '  CL_STAGE_INPUT_MISSING:\n'
        '    "该阶段所需的上游交接物在本链中未产出 → 依赖顺序未满足，属链路装配问题。",\n'
        '  CL_LIFECYCLE_CONFIG_MISSING:\n'
        '    "生命周期配置缺失 → 该阶段无法确定评估口径。",\n'
        '};',
        'const BLOCKED_REASON_HUMAN: Readonly<Record<string, string>> = {\n'
        '  CL_DATA_NOT_INJECTED:\n'
        '    "服务端未拿到数据集 → 后续阶段无数据可用。",\n'
        '  CL_DATASET_GATE_NOT_PASS:\n'
        '    "数据集预检未通过（库内 dataset_version.status 非 READY）→ 数据阶段阻塞。",\n'
        '  CL_RUNNER_NOT_INJECTED:\n'
        '    "该阶段尚无真实执行器 → 下游一并阻塞。属功能未覆盖，非运行错误。",\n'
        '  CL_UPSTREAM_BLOCKED:\n'
        '    "上游阶段阻塞 → 先解决上游（禁止伪造中间产物）。",\n'
        '  CL_WIRING_ARTIFACT_MISSING:\n'
        '    "装配层缺少该阶段所需的重对象。",\n'
        '  CL_STAGE_INPUT_MISSING:\n'
        '    "该阶段所需的上游交接物未产出。",\n'
        '  CL_LIFECYCLE_CONFIG_MISSING:\n'
        '    "生命周期配置缺失，无法确定评估口径。",\n'
        '};',
    ),
    (
        '      description="真实执行轨迹（researchRun.loopRun）：入参齐备的阶段真跑，缺入参/无执行器的阶段如实 BLOCKED。"',
        '      description="真实执行轨迹：入参齐备的阶段真跑，缺入参 / 无执行器的如实标为 BLOCKED。"',
    ),
    (
        '            <span>\n'
        '              本次运行 {total} 个阶段无一执行 —— 不是「卡住」，也不是「代码没写完」。\n'
        '            </span>',
        '            <span>本次 {total} 个阶段无一执行。</span>',
    ),
    (
        '          <p className="mt-1.5 pl-5">\n'
        '            {blockedHuman ??\n'
        '              "原因见下方「阻塞原因」列：每个阶段都如实说明了缺哪一项入参。"}\n'
        '          </p>',
        '          <p className="mt-1.5 pl-5">\n'
        '            {blockedHuman ?? "原因见下方「阻塞原因」列。"}\n'
        '          </p>',
    ),
])

# ---------------------------------------------------------------------------
# 3. StrategyVersionPanel
# ---------------------------------------------------------------------------
group(p(C, "StrategyVersionPanel.tsx"), [
    (
        'const STATUS_HINT: Record<string, string> = {\n'
        '  Draft: "草稿：刚写完，尚未进入研究流程。",\n'
        '  Research: "研究中：正在做文献与特征假设。",\n'
        '  Candidate: "候选：有研究证据，等待取舍。",\n'
        '  Validated: "已验证：通过了数据集门槛与验证。",\n'
        '  Paper: "纸面交易：前向跟踪中，尚未投入真金。",\n'
        '  Approved: "已批准：评审通过，可以上线。",\n'
        '  Production: "生产中：正在实盘运行。",\n'
        '  Retired: "已退役：不再使用（终态）。",\n'
        '};',
        'const STATUS_HINT: Record<string, string> = {\n'
        '  Draft: "草稿：尚未进入研究流程。",\n'
        '  Research: "研究中：正在做假设与验证。",\n'
        '  Candidate: "候选：有研究证据，等待取舍。",\n'
        '  Validated: "已验证：通过了数据集门槛。",\n'
        '  Paper: "纸面交易：前向跟踪，未投真金。",\n'
        '  Approved: "已批准：评审通过，可上线。",\n'
        '  Production: "生产中：实盘运行。",\n'
        '  Retired: "已退役：终态。",\n'
        '};',
    ),
    (
        '          <p className="text-xs text-muted-foreground">\n'
        '            后端没有返回任何版本——这个策略可能还没有落库版本。先在页头点「保存」。\n'
        '          </p>',
        '          <p className="text-xs text-muted-foreground">暂无版本。</p>',
    ),
    (
        '        {savedDocument === null ? (\n'
        '          <p className="flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-800">\n'
        '            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />\n'
        '            <span>\n'
        '              当前草稿还没有落库对照物（页面默认模板，或尚未加载任何版本）。\n'
        '              先在页头「保存」，或在「版本历史」里「载入」一个版本，才能做差异对比。\n'
        '            </span>\n'
        '          </p>\n'
        '        ) : (\n'
        '          <>\n'
        '            <p className="text-[11px] text-muted-foreground">\n'
        '              左：已落库 <code className="font-mono">{strategyId}@{version}</code>\n'
        '              ；右：当前编辑器草稿。忽略 version / fingerprint（派生字段）。\n'
        '            </p>\n'
        '          </>\n'
        '        )}',
        '        {savedDocument === null ? (\n'
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            没有落库对照物 —— 先「保存」，或在版本历史里「载入」一个版本。\n'
        '          </p>\n'
        '        ) : (\n'
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            左：已落库 <code className="font-mono">{strategyId}@{version}</code>；右：当前草稿（忽略 version / fingerprint）。\n'
        '          </p>\n'
        '        )}',
    ),
    (
        '                草稿与已落库版本等价（忽略 version / fingerprint）—— 没有未保存的改动。',
        '                与已落库版本一致（忽略 version / fingerprint），无未保存改动。',
    ),
    (
        '        description="只改 `strategy_versions.status` 一列（内容不可变）——这是后端唯一允许的 UPDATE。"',
        '        description="只改 status 一列；策略内容不可变。"',
    ),
    (
        '          <p className="text-xs text-muted-foreground">\n'
        '            取不到当前版本的状态（版本行未返回）。常见原因：该版本尚未落库，或版本列表还没加载完。\n'
        '          </p>',
        '          <p className="text-xs text-muted-foreground">取不到该版本状态。</p>',
    ),
    (
        '            <p className="text-[11px] leading-relaxed text-muted-foreground">\n'
        '              ⚠️ 这是**真实写库**操作，会立刻改变该版本在后端的生命周期状态。\n'
        '              策略内容（StrategyDocument）不受影响，也不会因此新建版本。\n'
        '            </p>',
        '            <p className="text-[11px] leading-relaxed text-muted-foreground">\n'
        '              ⚠️ 真实写库：即刻改变该版本的生命周期状态，不改策略内容、不新建版本。\n'
        '            </p>',
    ),
])

# ---------------------------------------------------------------------------
# 4. PositionSizingEditor
# ---------------------------------------------------------------------------
group(p(C, "PositionSizingEditor.tsx"), [
    (
        '      title="仓位与资金规则"\n'
        '      icon={Percent}\n'
        '      description="声明式仓位分派与初始资金，不执行；执行由后续回测引擎消费"\n',
        '      title="仓位与资金规则"\n      icon={Percent}\n',
    ),
    (
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            回测账户起点资金，用于计算仓位数与收益率。\n'
        '          </p>\n',
        '',
    ),
    (
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            同时持有的最大股票数量。\n'
        '          </p>\n',
        '',
    ),
    (
        '            <p className="text-[11px] text-muted-foreground">\n'
        '              每只占用初始资金的固定比例（如 0.1 = 10%）。\n'
        '            </p>',
        '            <p className="text-[11px] text-muted-foreground">\n'
        '              如 0.1 = 10%。\n'
        '            </p>',
    ),
])

# ---------------------------------------------------------------------------
# 5. StrategyBasicInfo
# ---------------------------------------------------------------------------
group(p(C, "StrategyBasicInfo.tsx"), [
    (
        '      description="策略身份与数据绑定（§16 identity；Dataset 坐标来自 Dataset Registry）"',
        '      description="策略身份与数据绑定"',
    ),
    (
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            绑定保存的是 <code className="font-mono">datasetVersionId（dataset_version.id）</code>\n'
        '            ；<code className="font-mono">datasetVersion</code> 只是显示 / 快照 label。\n'
        '            保存时后端会查 Dataset Registry 校验「存在 且 READY 且属于该数据集」，不通过即拒绝保存。\n'
        '          </p>',
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            绑定存的是 <code className="font-mono">datasetVersionId</code>；保存时后端校验「存在且 READY」，不通过即拒绝。\n'
        '          </p>',
    ),
    (
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            派生股票池须等于{" "}\n'
        '            <code className="font-mono">research-dataset:&lt;datasetVersion&gt;</code>\n'
        '            ，选择数据集版本时自动同步；静态白名单可用显式 members（暂不在本页编辑）。\n'
        '          </p>',
        '          <p className="text-[11px] text-muted-foreground">\n'
        '            须等于 <code className="font-mono">research-dataset:&lt;datasetVersion&gt;</code>，选版本时自动同步。\n'
        '          </p>',
    ),
])

# ---------------------------------------------------------------------------
# 6. RuleEditor —— 页头已不再重复描述规则语义，这里也只留硬事实
# ---------------------------------------------------------------------------
group(p(C, "RuleEditor.tsx"), [
    (
        '        <Sparkles className="h-3 w-3 shrink-0" />\n'
        '        规则之间为{" "}\n'
        '        <span className="font-medium text-foreground">AND（全部满足）</span>{" "}\n'
        '        关系；「说明」是唯一完整语义，字段/操作符/数值为机器可读片段（供审计与未来执行器引用）。',
        '        <Sparkles className="h-3 w-3 shrink-0" />\n'
        '        规则之间为{" "}\n'
        '        <span className="font-medium text-foreground">AND（全部满足）</span>\n'
        '        ；「说明」是唯一完整语义。',
    ),
])

# ---------------------------------------------------------------------------
# 7. StrategyJsonEditor
# ---------------------------------------------------------------------------
group(p(C, "StrategyJsonEditor.tsx"), [
    (
        '      description="透传完整 StrategyDocument；fingerprint 为占位，真实指纹由后端序列化重算"',
        '      description="真实指纹由后端重算"',
    ),
])

# ---------------------------------------------------------------------------
# 8. StrategyAdvancedTools
# ---------------------------------------------------------------------------
group(p(C, "StrategyAdvancedTools.tsx"), [
    (
        '      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">\n'
        '        这只是把「版本号该写成什么」算出来。真正落库走页头的「另存为新版本」\n'
        '        （后端会按内容差异自行判定 bump 语义）。\n'
        '      </p>',
        '      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">\n'
        '        只算版本号；真正落库走「另存为新版本」。\n'
        '      </p>',
    ),
    (
        '          <span>\n'
        '            这是一件**审计校验工具**：后端 <code className="font-mono">transition</code>{" "}\n'
        '            是纯函数（无 DB、无 IO），记录由本页持有并从上次结果继续，**不会**写进数据库。\n'
        '            要看 / 改策略的真实状态，请用上面的「版本状态」。\n'
        '          </span>',
        '          <span>\n'
        '            审计校验工具：后端 <code className="font-mono">transition</code> 是纯函数，\n'
        '            记录不写库。要看 / 改真实状态，请用上面的「版本状态」。\n'
        '          </span>',
    ),
    (
        '            下面这份壳是**示例**（坐标属于示例策略，不是当前策略）。timestamp / actor\n'
        '            为注入式字段，页面默认值仅供演示。',
        '            下面是示例壳（坐标非当前策略）；timestamp / actor 为注入式字段。',
    ),
    ('          校验并应用这一次迁移', '          应用这次迁移'),
])

# ---------------------------------------------------------------------------
# 9. StrategyResearchProvenancePanel
# ---------------------------------------------------------------------------
group(
    p(ROOT, r"client\src\components\research", "StrategyResearchProvenancePanel.tsx"),
    [
        (
            '      description={`${strategyId}@${version} —— 这条策略是从哪一次研究推导出来的`}',
            '      description={`${strategyId}@${version} · 只读`}',
        ),
        (
            '          溯源读取失败：{query.error.message}\n'
            '          <br />\n'
            '          这不影响该策略的读取与执行 —— 溯源只是附加信息。',
            '          溯源读取失败：{query.error.message}（不影响策略的读取与执行）',
        ),
        (
            '              该版本没有 Research 溯源记录。\n'
            '              {vm.strategyVersionId === null\n'
            '                ? "（版本行也没读到 —— 请确认策略 ID 与版本号。）"\n'
            '                : "（这条策略不是由研究候选转正产生的，或溯源行已被清理。）"}',
            '              {vm.strategyVersionId === null\n'
            '                ? "没有溯源记录（版本行也没读到 —— 请确认策略 ID 与版本号）。"\n'
            '                : "没有溯源记录（不是由研究候选转正产生的，或溯源行已清理）。"}',
        ),
        (
            '              执行绑定是「Strategy 侧」事实（落 <code className="font-mono">strategy_version_datasets</code>）；\n'
            '              来源 Dataset 是 promote 时刻的快照 —— 两者可以不同，这正是「研究用一份数据、执行覆盖另一份」的合法路径。',
            '              执行绑定是 Strategy 侧事实，来源 Dataset 是 promote 时刻快照 —— 两者可以不同（研究用一份、执行覆盖另一份）。',
        ),
    ],
)

# ---------------------------------------------------------------------------
# 10. 引用已下线文件 / 已消失文案的注释（防「文档说 A、代码是 B」）
# ---------------------------------------------------------------------------
group(p(ROOT, r"client\src\components\research", "candidateSketchCostPreset.ts"), [
    (
        ' *     `client/src/pages/StrategyEditor.tsx` 模板的 `executionAssumptions` 用的是同一组数字。',
        ' *     `client/src/pages/StrategyDetail.tsx` 模板的 `executionAssumptions` 用的是同一组数字。',
    ),
])
group(p(ROOT, r"client\src\lib", "status.ts"), [
    (
        '  // 生命周期状态（StrategyEditor §23）',
        '  // 生命周期状态（策略详情页 §23）',
    ),
])
group(p(ROOT, r"tests\client\src\components\research", "strategyCandidateUiContract.test.ts"), [
    (
        ' *   - `pages/StrategyEditor.tsx` 只**渲染**溯源区（请求由面板组件发出），故不算调用点。',
        ' *   - `pages/StrategyDetail.tsx` 只**渲染**溯源区（请求由面板组件发出），故不算调用点。',
    ),
])
group(p(ROOT, r"docs\evidence", "_e2e_strategy_workbench.mts"), [
    (
        ' * 探针：策略工作台（`/strategy-editor`）重设计后的**真实链路验收** —— 零写入、只读。',
        ' * 探针：策略详情页（`/strategies/:strategyId`，旧地址 `/strategy-editor` 已改为兼容跳转）\n'
        ' * 的真实链路验收 —— 零写入、只读。',
    ),
    (
        ' *   3. `compare` 的「无改动」判据（页头「这次改了什么」依赖它）；',
        ' *   3. `compare` 的「无改动」判据（版本与状态页签的差异对比依赖它）；',
    ),
    (
        '    section("5. compare 的「无改动」判据（页头「这次改了什么」依赖它）");',
        '    section("5. compare 的「无改动」判据（版本与状态页签的差异对比依赖它）");',
    ),
])


def main():
    failures = []
    for path, pairs in GROUPS:
        raw = io.open(path, encoding="utf-8", newline="").read()
        nl = "\r\n" if "\r\n" in raw else "\n"
        out = raw
        for old, new in pairs:
            o = old.replace("\n", nl)
            n = new.replace("\n", nl)
            c = out.count(o)
            if c != 1:
                failures.append((path, c, old.split("\n")[0][:90]))
                continue
            out = out.replace(o, n)
        if any(f[0] == path for f in failures):
            print("SKIP(未写入) %s" % os.path.relpath(path, ROOT))
            continue
        io.open(path, "w", encoding="utf-8", newline="").write(out)
        print("OK  %-62s %d 处" % (os.path.relpath(path, ROOT), len(pairs)))
    if failures:
        print("\n=== 未命中（需人工核对原文）===")
        for path, c, head in failures:
            print("  %s  命中 %d 次 | %s" % (os.path.relpath(path, ROOT), c, head))
        sys.exit(1)
    print("\n全部 %d 个文件改写完成。" % len(GROUPS))


main()
