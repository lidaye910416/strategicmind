"""
Typed shock library for the loop-engine v2 (T1.6).

This module replaces the v1 ``maybe_generate_external_event`` (which
asked the LLM to fabricate shock descriptions) with a hand-authored,
deterministic catalogue of typed external events. The audit's #4
finding flagged the LLM-curated shocks as fabricated; the new
library makes the round-timing honest and the inventory finite.

Each entry is shaped::

    {
        "category": "regulatory" | "supply" | "competitor" | "market_shift",
        "text":     <short Chinese description, ≤80 chars>,
        "shock_level": 0.4 | 0.6 | 0.8,
        "channels":  [PropagationChannel, ...],
    }

``shock_level`` is calibrated per the loop-engine-v2 spec §T1.6:

* regulatory: 0.6 (medium — changes rules, not physics)
* supply:     0.4 (mild  — most supply issues are localised)
* market:     0.8 (high   — direct P&L impact)
* competitor: 0.6 (medium — share-of-voice shift)

A 12-round run samples one entry per category with probability 0.10
per round (1.5× at the round-12 burst window). The total per-12-round
count is therefore expected at ~5, but in practice observed in 1-3
draws (the per-round Bernoulli is a small probability over 12 draws).
"""
from __future__ import annotations

from typing import Dict, List

from ...models.action_type import PropagationChannel


# ---------------------------------------------------------------------------
# Catalogue — 12 entries per category
# ---------------------------------------------------------------------------

_REGULATORY: List[Dict] = [
    {"text": "反垄断监管新规出台，限制头部企业并购。", "shock_level": 0.6},
    {"text": "数据合规法生效，要求上市公司公开算法说明。", "shock_level": 0.6},
    {"text": "行业准入门槛上调，新设审批时间延长 6 个月。", "shock_level": 0.6},
    {"text": "出口管制名单更新，公司部分产品需重新申请许可。", "shock_level": 0.6},
    {"text": "碳排放披露要求扩面至中型企业。", "shock_level": 0.6},
    {"text": "行业税率上调 2 个百分点。", "shock_level": 0.6},
    {"text": "平台经济反垄断指南更新，对生态合作模式提出新约束。", "shock_level": 0.6},
    {"text": "新劳动合同法解释出台，灵活用工成本上升。", "shock_level": 0.6},
    {"text": "广告投放需事先审核，部分行业内容受限。", "shock_level": 0.6},
    {"text": "海外子公司需提交年度合规报告。", "shock_level": 0.6},
    {"text": "强制性 ESG 评级引入采购评标。", "shock_level": 0.6},
    {"text": "AI 行业透明度要求开始执行。", "shock_level": 0.6},
]

_SUPPLY: List[Dict] = [
    {"text": "核心供应商因灾停产，交付周期延长 30 天。", "shock_level": 0.4},
    {"text": "海外原材料价格季度内上涨 12%。", "shock_level": 0.4},
    {"text": "物流运力紧张，跨区运费上浮 18%。", "shock_level": 0.4},
    {"text": "关键零部件替代厂商认证周期延长。", "shock_level": 0.4},
    {"text": "上游工艺升级，导致部分 SKU 暂时断供。", "shock_level": 0.4},
    {"text": "芯片产能受限，分配比例下调。", "shock_level": 0.4},
    {"text": "能源价格波动，工厂用电成本上升。", "shock_level": 0.4},
    {"text": "海运时效不可控，库存周转天数上升。", "shock_level": 0.4},
    {"text": "二线供应商出现财务危机，存在断供风险。", "shock_level": 0.4},
    {"text": "包装材料合规要求调整，需重新选型。", "shock_level": 0.4},
    {"text": "代工厂 Q4 排产紧张，议价能力下降。", "shock_level": 0.4},
    {"text": "部分关键原料受许可证制度影响。", "shock_level": 0.4},
]

_COMPETITOR: List[Dict] = [
    {"text": "主要竞争对手完成 30 亿元融资，发起价格战。", "shock_level": 0.6},
    {"text": "新进入者发布同质化产品，0 元试用 90 天。", "shock_level": 0.6},
    {"text": "竞品在头部 KOL 渠道集中投放，曝光量激增。", "shock_level": 0.6},
    {"text": "国际巨头进入本地市场，本地化版本上线。", "shock_level": 0.6},
    {"text": "竞品收购业内关键渠道方。", "shock_level": 0.6},
    {"text": "竞品发布新一代旗舰产品，性能领先一代。", "shock_level": 0.6},
    {"text": "竞争对手开源核心模块，行业生态重构。", "shock_level": 0.6},
    {"text": "竞品推出 1 元试用策略，拉新成本飙升。", "shock_level": 0.6},
    {"text": "跨行业巨头跨界进入本赛道。", "shock_level": 0.6},
    {"text": "竞品与渠道方签订独家合作协议。", "shock_level": 0.6},
    {"text": "竞品组建 200 人销售铁军，主攻腰部客户。", "shock_level": 0.6},
    {"text": "竞品完成对一家区域龙头的并购。", "shock_level": 0.6},
]

_MARKET_SHIFT: List[Dict] = [
    {"text": "消费者偏好向高性价比产品快速迁移。", "shock_level": 0.8},
    {"text": "宏观经济不确定性上升，企业 IT 支出推迟。", "shock_level": 0.8},
    {"text": "汇率剧烈波动，海外收入折算受影响。", "shock_level": 0.8},
    {"text": "资本市场对行业估值倍数大幅下调。", "shock_level": 0.8},
    {"text": "人口结构变化，目标用户规模收缩。", "shock_level": 0.8},
    {"text": "利率上行，融资成本显著增加。", "shock_level": 0.8},
    {"text": "消费降级蔓延，部分品类客单价下移 20%。", "shock_level": 0.8},
    {"text": "新兴市场快速增长，公司未提前布局。", "shock_level": 0.8},
    {"text": "行业整体增速从 +15% 跌至 +3%。", "shock_level": 0.8},
    {"text": "广告投放 ROI 行业均值下滑 30%。", "shock_level": 0.8},
    {"text": "用户日均使用时长被新形态应用挤占。", "shock_level": 0.8},
    {"text": "原材料周期切换，下游议价权变化。", "shock_level": 0.8},
]


SHOCK_LIBRARY: Dict[str, List[Dict]] = {
    "regulatory": _REGULATORY,
    "supply": _SUPPLY,
    "competitor": _COMPETITOR,
    "market_shift": _MARKET_SHIFT,
}


# Default propagation channels per category. These match the design
# §1.6 column header.
DEFAULT_CHANNELS_BY_CATEGORY: Dict[str, List[PropagationChannel]] = {
    "regulatory": [PropagationChannel.OFFICIAL, PropagationChannel.MEDIA],
    "supply": [PropagationChannel.MARKET_SIGNAL],
    "competitor": [PropagationChannel.MEDIA, PropagationChannel.DIRECT],
    "market_shift": [PropagationChannel.MARKET_SIGNAL, PropagationChannel.MEDIA],
}


VALID_SHOCK_LEVELS: tuple = (0.4, 0.6, 0.8)


def is_valid_shock_level(value: float) -> bool:
    """T1.6 acceptance: shock_level must be in {0.4, 0.6, 0.8}."""
    return float(value) in VALID_SHOCK_LEVELS


__all__ = [
    "SHOCK_LIBRARY",
    "DEFAULT_CHANNELS_BY_CATEGORY",
    "VALID_SHOCK_LEVELS",
    "is_valid_shock_level",
]
