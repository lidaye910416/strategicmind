/**
 * Centralized Chinese localization strings.
 *
 * Keep all user-facing UI text in this file so the localization
 * stays single-sourced and easy to extend.
 *
 * NOTE: API protocol field names (config keys, stage enum values)
 * stay in English - those are wire-format. Only display text is
 * translated.
 */

export const STAGE_LABELS: Record<string, string> = {
  SEED_PARSING: '解析种子文档',
  GRAPH_BUILDING: '构建知识图谱',
  ENTITY_EXTRACTION: '抽取实体关系',
  PROFILE_GENERATION: '生成 Agent 画像',
  CONFIG_GENERATION: '生成仿真配置',
  SIMULATION_RUNNING: '执行多 Agent 推演',
  REPORT_GENERATING: '生成战略报告',
  COMPLETED: '已完成',
  FAILED: '失败',
}

export const STAGE_DESCRIPTIONS: Record<string, string> = {
  SEED_PARSING:
    '读取用户上传的种子文档（PDF/Word/TXT），按段落切分，为后续阶段提供统一文本。',
  GRAPH_BUILDING:
    '把文本送入 LLM，识别其中的实体（组织/人物/产品/业务/技术/资本）并建立关系，形成可检索的知识图谱。',
  ENTITY_EXTRACTION:
    '在更细粒度上抽取实体属性和实体间关系，输出 GraphRAG 用的节点与边。',
  PROFILE_GENERATION:
    '为每个利益相关方实体生成 Agent 画像：立场、影响力权重、行动偏好、初始信念。',
  CONFIG_GENERATION:
    '把画像组装成仿真配置：Agent 列表、推演回合数、模拟时长（小时）、监控指标。',
  SIMULATION_RUNNING:
    '多 Agent 在 BeliefEngine 上做博弈推演，每轮产生行动、信念更新、阵营组合，模拟战略选择过程。',
  REPORT_GENERATING:
    '把仿真结果与原始战略目标交叉分析，输出一份可读的战略推演报告（执行摘要 / 风险 / 共识 / 建议）。',
}

export const STATUS_LABELS: Record<string, string> = {
  idle: '待启动',
  running: '运行中',
  paused: '已暂停',
  completed: '已完成',
  failed: '失败',
  cancelled: '已取消',
}

export const REPORT_STYLE_LABELS: Record<string, string> = {
  executive: '高管摘要',
  technical: '技术分析',
  narrative: '叙述报告',
}

export const REPORT_STYLE_DESCRIPTIONS: Record<string, string> = {
  executive: '面向管理层：结论先行，关键风险与建议优先展示。',
  technical: '面向业务/技术团队：包含推演指标、数据图表、决策树。',
  narrative: '面向阅读：讲一个完整的战略故事，逻辑连贯。',
}

export const STAKEHOLDER_TYPE_LABELS: Record<string, string> = {
  SHAREHOLDER: '股东',
  BOARD_MEMBER: '董事会成员',
  EXECUTIVE: '高管',
  COMPETITOR: '竞争对手',
  REGULATOR: '监管方',
  CORPORATE_EXEC: '企业高管',
  GOVERNMENT: '政府方',
  CUSTOMER: '客户',
  PARTNER: '合作伙伴',
  EMPLOYEE: '员工',
}

export const CLUSTER_STANCE_LABELS: Record<string, string> = {
  supportive: '支持',
  opposed: '反对',
  neutral: '中立',
}

export const COMMON = {
  appName: '战略智脑',
  appNameEn: 'StrategicMind',
  tagline: '多 Agent 博弈推演 · 战略预测与决策辅助',
  brandVersion: 'v0.1',
  back: '返回',
  backToDashboard: '返回工作台',
  loading: '加载中…',
  loadingReport: (id: string) => `正在加载报告 ${id}…`,
  loadingSimulation: (id: string) => `正在加载推演 ${id}…`,
  thinking: '正在思考…',
  cancel: '取消',
  confirm: '确认',
  view: '查看',
  refresh: '刷新',
  newRun: '新建推演',
  optional: '（可选）',
  uploaded: '已上传',
  generatedAt: (date: string) => `生成于 ${date}`,
  notFound: '未找到',
  cannotLoadReport: '无法加载报告',
  notFoundHint: '找不到该报告。请先运行一次推演以生成报告。',
  loadFailed: '加载失败',
  noData: '暂无数据',
  notAvailable: '不适用',
  notStarted: '未开始',
  inProgress: '进行中',
  done: '完成',
  failed: '失败',
}

export const DEMO = {
  caseTitle: '案例示范：湖北省数字产业发展集团"十五五"战略推演',
  caseSubtitle:
    '本案例以湖北数产集团公开的"十五五"战略规划为输入，演示系统如何从一份战略规划文档出发，通过 7 步全自动流水线，输出多 Agent 博弈推演结论与战略预测报告。',
  caseRunId: '案例运行 ID：run_a869a890',
  useThisCase: '直接查看此案例',
  collapseCase: '收起案例',
  showCase: '展开案例',
  caseFileName: 'hubei_plan_seed.txt（49 行 · 853 字）',
  caseDocBackground: '输入文档',
  caseDocBackgroundDesc:
    '上传种子文件"湖北省数字产业发展集团"十五五"战略发展规划"的核心要点。',
  step1Title: '第 1 步 · 解析种子文档（SEED_PARSING）',
  step1Output: '产物',
  step1OutDesc: '1 份文档已被切分、登记并进入流水线。',
  step2Title: '第 2 步 · 构建知识图谱（GRAPH_BUILDING）',
  step2OutDesc: '从文档中识别出 1 个核心实体。',
  step3Title: '第 3 步 · 抽取实体关系（ENTITY_EXTRACTION）',
  step3OutDesc: '形成实体-属性-关系三元组。',
  step4Title: '第 4 步 · 生成 Agent 画像（PROFILE_GENERATION）',
  step4OutDesc: '为利益相关方生成可推演的 Agent。',
  step5Title: '第 5 步 · 生成仿真配置（CONFIG_GENERATION）',
  step5OutDesc: '把画像组装成仿真可执行的配置。',
  step6Title: '第 6 步 · 执行多 Agent 推演（SIMULATION_RUNNING）',
  step6OutDesc: '3 轮博弈，Agent 在 BeliefEngine 上演化和行动。',
  step7Title: '第 7 步 · 生成战略报告（REPORT_GENERATING）',
  step7OutDesc: '产出 1 份可读的战略推演报告。',
  stageGoalTitle: '这一步在做什么',
  stageOutputTitle: '这一步的产物',
  stageInsightTitle: '用户怎么用',
  step1Goal:
    '读取并切分上传的 PDF/Word/TXT，为后续阶段提供统一语料。',
  step1Insight:
    '看文档是否被正确登记。如果切分有误，可以重新上传更高质量的种子文件。',
  step2Goal:
    '用 LLM 从文本中识别实体（组织/人物/产品/业务），形成知识图谱节点。',
  step2Insight:
    '在"推演视图"中可以看到识别出的所有实体；识别不全时，可以补充更结构化的种子文档。',
  step3Goal:
    '进一步抽取实体间关系：合作 / 竞争 / 投资 / 监管 等。',
  step3Insight:
    '关注"关系密度"：关系越多，博弈推演越能模拟真实多方互动。',
  step4Goal:
    '为每个利益相关方实体生成 Agent 画像：立场、影响力、行动偏好、初始信念。',
  step4Insight:
    '关注"Agent 类型分布"：股东/高管/对手/监管 缺一不可，否则推演视角会偏。',
  step5Goal:
    '把画像组装成仿真可执行配置：Agent 列表、回合数、模拟小时、监控指标。',
  step5Insight:
    '这是推演前的"剧本"：决定跑多快、跑多深、看什么指标。',
  step6Goal:
    '多 Agent 在 BeliefEngine 上做博弈推演，每轮产生行动、信念更新、阵营组合。',
  step6Insight:
    '看"信念演化"和"利益相关方"分布：分歧出现在哪一轮、共识何时形成。',
  step7Goal:
    '把仿真结果与原始战略目标交叉分析，输出一份可读的战略推演报告。',
  step7Insight:
    '这是用户最终交付的产物。可以导出、打印，或在"与报告对话"框中追问细节。',
  goToReport: '查看完整报告',
  goToSimulation: '查看推演过程',
  goToDashboard: '上传自己的文档重新推演',
  viewDemo: '查看案例示范',
}

export const DASHBOARD = {
  headerSubtitle: '多 Agent 博弈推演 · 战略预测与决策辅助',
  openConfig: '配置',
  closeConfig: '收起',
  step1: '上传种子文档',
  step1Hint: '支持 .txt / .md / .pdf，拖拽到下方或点击选择。',
  step2: '仿真参数配置',
  step2Hint: '默认值已可适用于多数场景；进阶用户可按需调整。',
  step3: '运行推演流水线',
  step3Hint: '点击启动后，7 步全自动执行，可随时暂停 / 恢复 / 取消。',
  needDoc: '请先上传至少一个文档，再启动推演。',
  start: '启动推演',
  viewReport: '查看报告 →',
  pause: '⏸ 暂停',
  resume: '▶ 继续',
  cancel: '✕ 取消',
  liveView: '实时视图',
  newRun: '新建推演',
  hours: '模拟时长（小时）',
  hoursSuffix: '小时',
  hoursHint: '默认 72 小时（约 3 个月），对应一个季度节奏的战略推演。',
  reportStyle: '报告风格',
  noPipeline: '尚未启动推演',
  pipelineRunning: '推演运行中',
  pipelinePaused: '推演已暂停',
  pipelineCompleted: '推演已完成',
  pipelineFailed: '推演失败',
  pipelineCancelled: '推演已取消',
  pipelineIdle: '待启动',
  errorBox: (msg: string) => `出错了：${msg}`,
  stageTitle: '7 步推演流水线',
  progress: '进度',
  // P3-A: 多维度参数化
  years: '模拟年限',
  yearsUnit: (n: number) => `${n} 年`,
  yearsHint: '推演覆盖的未来时间范围（1–5 年）',
  timeStep: '时间步长',
  timeStepHint: '每回合代表的真实时长',
  departments: '公司部门',
  departmentsCount: (n: number, total: number) => `已选 ${n} / ${total}`,
  departmentsHint: '至少 1 个；只生成所选部门的 Agent',
  nStakeholders: '模拟对象数',
  nStakeholdersHint: '6–24，影响推演广度',
  externalFactors: '外部因素',
  externalFactorsHint: '每行一条，最多 10 条；将作为环境信号注入 LLM',
  externalFactorsPlaceholder: '例：竞品下月降价 20%；新政策补贴；技术突破',
  emergencePolicy: '涌现策略',
  emergencePolicyHint: '控制 LLM 周期性涌现新实体的强度',
  convergencePolicy: '收敛策略',
  convergencePolicyHint: '推演达到共识后是否自动续推',
  summary: (years: number, deptCount: number, factorCount: number) =>
    `预计覆盖 ${years} 年 · 涉及 ${deptCount} 个部门${factorCount > 0 ? ` · 注入 ${factorCount} 条外部因素` : ''}`,
}

export const UPLOADER = {
  dropOrClick: '拖拽文件到此处，或点击选择',
  supports: '支持 .txt / .md / .pdf',
  failed: (name: string, msg: string) => `上传 ${name} 失败：${msg}`,
}

export const SIMULATION = {
  title: '推演视图',
  round: '当前回合',
  total: '总回合',
  activeAgents: '活跃 Agent',
  progress: '进度',
  beliefTitle: '信念演化',
  beliefEmpty: '尚无信念数据（推演第一轮尚未完成）',
  clustersTitle: (n: number) => `Agent 阵营 (${n})`,
  clustersEmpty: '尚无阵营数据',
  stakeholdersTitle: (n: number) => `利益相关方关系图 (${n})`,
  loading: '加载中…',
  failed: '加载失败',
  pause: '⏸ 暂停',
  resume: '▶ 继续',
  cancel: '✕ 取消',
  viewReport: '查看报告',
  roundAxis: '回合',
  beliefValue: '信念值',
  xRound: '回合',
  yValue: '信念值',
  iterAxis: '迭代',
  iterTitle: '推演收敛趋势',
  iterEmpty: '尚无收敛数据',
  roundProgress: '回合进度',
  toastCompleted: '推演已完成',
  toastViewReport: '查看报告',
  toastFailed: (stage?: string) => `推演失败${stage ? `（${STAGE_LABELS[stage] || stage}）` : ''}`,
  toastPaused: '推演已暂停',
  riskTitle: '风险评估矩阵',
  riskEmpty: '未识别到风险',
  decisionTitle: '战略决策树',
  valuationTitle: '财务预测',
  valuationBase: '基准',
  valuationUp: '上行',
  valuationDown: '下行',
  baseScenario: '基准情景',
  upsideScenario: '上行情景',
  downsideScenario: '下行情景',
}

export const REPORT = {
  title: '战略推演报告',
  generatedAt: (date: string) => `生成于 ${date}`,
  runBadge: (id: string) => `运行 ID：${id}`,
  askTitle: '与报告对话',
  askEmpty: '在下方输入问题，对报告细节进行追问。',
  askPlaceholder: '例：研发人才 35% 占比目标可实现的关键路径是什么？',
  askSend: '发送',
  askError: '对话失败，请重试。',
  askDefaultError: '抱歉，处理你的问题时出错了。',
  userLabel: '我',
  assistantLabel: '报告助手',
  askHint:
    '你也可以在推演视图查看 7 步流水线的中间产物，例如信念演化、阵营分布、利益相关方关系。',
}

export const CONFIG = {
  title: '推演参数',
  hours: '模拟时长（小时）',
  hoursHint: '默认 72 小时；范围 24–168。',
  rounds: '最大推演回合',
  roundsHint: '默认 3 轮；范围 1–50。',
  style: '报告风格',
}

export const APP_ROUTES = {
  home: '/',
  workbench: '/workbench',
  workbenchWithRun: (id: string) => `/workbench/${id}`,
  simulation: (id: string) => `/simulation/${id}`,
  report: (id: string) => `/report/${id}`,
  compare: '/compare',
  compareWithRuns: (ids: string[]) => `/compare?runs=${ids.map(encodeURIComponent).join(',')}`,
  notFound: '404 - 页面不存在',
}


export const WORKBENCH = {
  title: '推演工作台',
  subtitle: '左侧公司态势与部门博弈，右侧 7 步流水线全流程可视化。',
  companySection: '公司态势',
  departments: '部门 Agent',
  debateSection: '部门博弈推演',
  debateTitle: '输入议题，看各部门立场与公司级决议',
  debatePlaceholder: '例：是否加大 AI 研发投入 / 是否拓展海外市场 / 如何应对竞品价格战',
  debateRun: '推演',
  companyStance: '公司级立场',
  stagesTitle: '7 步流水线',
  running: '进行中',
  done: '已完成',
  startTitle: '准备开始推演',
  startDesc: '点击下方按钮启动 7 步全自动推演。推演过程中可暂停 / 继续 / 取消，结束后可查看完整战略报告。',
  start: '启动推演',
  timelineTitle: '实时博弈',
  timelineSubtitle: '实时博弈事件流',
  statMargin: '基准毛利率',
  statShock: '抗冲击韧性',
  statCycle: '市场周期',
  runMultiRound: '▶ 多回合连续推演',
  runMultiRoundTitle: '用 4 个典型战略议题连续推演 4 回合',
  multiRoundResults: '多回合推演结果',
  multiRoundProgress: (cur: number, total: number) => `第 ${cur}/${total} 回合`,
  downloadReportTitle: '下载公司级报告（Markdown 格式）',
  ctaStartNewRound: '用此立场开新一轮推演',
  ctaStartNewRoundTitle: '基于当前决议的立场，作为下一轮推演的初始上下文',
  etaApprox: (mins: number) => `预计还需 ~${mins} 分钟`,
}

export const WORKBENCH_SUBNAV = {
  realTimeGraph: '实时图谱',
  departmentDebate: '部门博弈',
  iterationNetwork: '迭代关系网',
  agentInterview: '智能体采访',
  heartbeat: '实时',
  heartbeatSecondsAgo: (s: number) => `${s} 秒前`,
  heartbeatStale: '连接已断开',
  notConnected: '未连接',
}

export const REPORT_TOC = {
  title: '目录',
  dropdownPlaceholder: '跳转到章节…',
}

export const DASHBOARD_ACTIONS = {
  cloneSuccessPrefix: '已从历史 run ',
  cloneSuccessTail: ' 复制配置：时长 / 报告风格 已自动填入',
  cloneFailed: (id: string) => `复制配置失败（run: ${id}），请手动配置参数`,
  cloneFailedConsole: '复制配置失败',
}

export const REPORT_ACTIONS = {
  deriveNewTopic: '派生新议题',
  actionListTitle: '行动清单',
  actionListProgress: (n: number, m: number) => `已完成 ${n} / ${m}`,
  actionListEmpty: '报告中暂无行动项',
  reuseAsTopic: '复用为议题',
}

export const AGENT_INTERVIEW = {
  setAsTopic: '设为议题',
  interviewFailedPrefix: '采访失败',
  interviewFailed: (msg: string) => `采访失败：${msg}`,
}

export const RECENT_RUNS = {
  copyConfig: '复制配置',
  copyConfigTitle: (id: string) => `复制此 run 的配置（时长 / 风格），run id: ${id}`,
  compare: '对比',
  compareTitle: '对比选中 N 个 run',
  compareSelectTitle: '勾选 2-3 个 run 进行对比',
  compareSelectHint: '已选 0 个 — 至少勾 2 个，最多 3 个',
  compareSelected: (n: number) => `已选 ${n} 个`,
  compareDisabledTitle: '对比功能当前已关闭（featureFlags.compareRuns = false）',
}

export const PROVIDER = {
  title: '切换 LLM 模型',
  subtitle: '点击切换到不同的模型提供方，下一次推演生效。',
  current: '当前',
  model: '模型',
  endpoint: '端点',
  local: '本地',
  cloud: '云端',
  needsKey: '需 Key',
  configured: '已配置',
  notConfigured: '未配置',
  inUse: '正在使用',
  clickToSwitch: '点击切换',
  switching: '切换中…',
  unavailable: '暂不可用',
  alreadyCurrent: '已经是当前模型',
  tip: '切换后仅影响后续推演；已生成的报告不受影响。',
  docs: '模型 API 文档',
  reset: '恢复自动检测',
  switchFailed: '切换失败',
  badge: '切换模型',
  badgeSwitching: '切换中',
}

export const COMPARE = {
  title: '多 Run 横向对比',
  subtitle: '并排查看多个推演 run 的决议、立场、行动分布。',
  selectFromHistory: '从历史选择',
  pickHint: 'URL 形如 /compare?runs=run_xxx,run_yyy（最多 3 个）',
  loading: '加载中…',
  loadFailed: '加载失败',
  noRuns: '请在 URL 中提供至少 2 个 run id，例如 ?runs=run_abc,run_def',
  noRunsLink: '去历史选择',
  resolutionTitle: '决议分布',
  resolutionSub: '按 run 对比决议（每个 run 的最终决议关键词计数）',
  stanceTitle: '阵营对比',
  stanceSub: '按 run 对比各阵营（支持 / 反对 / 中立）的 Agent 占比',
  actionTitle: '行动直方图',
  actionSub: '按 run 对比每种行动类型的次数（MAKE_STATEMENT / PROPOSE_DEAL 等）',
  legendRun: (id: string) => `Run ${id}`,
  emptyData: '暂无数据',
  chartEmpty: '该 run 无可用数据',
  moreThan3: '最多对比 3 个 run（已取前 3 个）',
  notCompleted: (n: number) => `${n} 个 run 未完成，仅显示已完成 run 的数据`,
}

