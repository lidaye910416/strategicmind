/**
 * StageCards - 7 步流水线富内容卡（re-export shim）。
 *
 * 来源：原 components/StageCards.tsx（439 行），P2-4 拆分为
 *       components/stages/ 目录下的 sub-component。
 * 本文件只做 re-export 保持原有 import 路径不变。
 *
 * 主实现：./stages/StageCards.tsx
 * 子组件：./stages/{seed,graph,entity,profile,config,simulation,report}.tsx
 * 共享：./stages/Stat.tsx  ./stages/meta.ts
 */
export { default } from './stages/StageCards'
