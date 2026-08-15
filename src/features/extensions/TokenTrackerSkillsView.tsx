// 技能中心懒加载入口：渲染 KKCoder 原生 SkillsCenter（替代 vendored
// TokenTracker SkillsPage）。不再需要 vendored providers / tt-dashboard
// 作用域样式——SkillsCenter 直接走 KKCoder 主题 token。
import { SkillsCenter } from "./SkillsCenter";

export default function TokenTrackerSkillsView() {
  return <SkillsCenter />;
}
