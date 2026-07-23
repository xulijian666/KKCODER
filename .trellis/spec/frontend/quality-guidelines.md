# 质量规范

> KKCoder 的代码标准、极简设计审查清单与禁止模式。

---

## 设计纲领

> **极简、克制、极致易读。**

KKCoder 是面向硬核开发者与高阶 AI 心流打造的客户端。一切界面元素必须摒弃廉价的玩具感，禁止使用原生 Emoji 作为主要 UI 元素，推崇高精度矢量 SVG 与无框扁平化（Flat Minimalist）交互。

---

## 图标规范

### 禁用 Emoji 作为主要 UI 图标

- **禁止**：在主状态栏、侧边栏、对话标签、控制按钮、物理路径行、右键上下文菜单等全局交互组件中使用原生彩色 Emoji 图标（如 📂, 📋, 🗑️, 🖥️, ⚙️）
- **替代方案**：统一使用线条精细、比例和谐的高保真单色 SVG 矢量轮廓图标
  - `strokeWidth` 设为 `2` 或 `2.5`
  - 尺寸限制在 `12px` ~ `14px`
  - 图标主色通过 `stroke="currentColor"` 继承主题色

### 图标实现示例

```tsx
// ClaudeIcon — 单色 SVG 图标
export const ClaudeIcon: React.FC<{ size?: number; color?: string }> = ({ size = 18, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ color }}>
    <path d="..." fill="currentColor" fillRule="nonzero" />
  </svg>
);
```

---

## 色彩规范

### 禁止硬编码颜色值

- **禁止**：在组件样式中硬编码任何绝对色彩值（如 `#ffffff`、`#000000`、`#3b82f6`）
- **替代方案**：所有颜色必须绑定 CSS 变量

### 主题变量绑定

| 用途 | 变量 |
|------|------|
| 主编辑区背景 | `var(--bg-main)` |
| 侧边栏背景 | `var(--bg-sidebar)` |
| 主文字 | `var(--text-primary)` |
| 辅助文字 | `var(--text-secondary)` |
| 分割线 | `var(--border-color)` |
| 悬浮背景 | `var(--bg-hover-item)` |
| 选中背景 | `var(--bg-active-item)` |
| 主题焦点色 | `var(--color-primary)` |

### 多主题支持

任何新开发的组件必须完美适配 6 套动态主题（3 套白天 + 3 套黑夜）。

---

## 按钮与交互规范

### 按钮高度克制

- 按钮垂直 Padding 严格控制在 `3px` ~ `5px`
- Border-radius 统一限制在 `4px`
- 常态下背景完全透明、无边框

```css
.btn-interactive {
  border: none !important;
  background-color: transparent !important;
  padding: 3px 5px;
  border-radius: 4px;
}
```

### 物理防抖 (Zero-Jitter)

- 禁止通过改变 `font-weight`、移动元素位置或改变容器高矮来响应用户操作
- 点击选中项时，仅改变背景高亮和字色，字体字重保持一致
- 交互列表必须设定固定高度与 `overflow-y`

### Badge 镂空设计

```css
.badge-overlay {
  border: 1.5px solid var(--bg-sidebar);
  transform: translate(25%, -25%);
}
```

---

## 终端 IME 规范

- **禁止**：重写隐藏 textarea 的 width、height 和 left/top 定位属性
- **正确做法**：保留 xterm.js 标准 cursor tracking，仅通过 z-index 将 `.xterm-helper-textarea` 置于最底层

```css
.xterm-helper-textarea {
  z-index: -10 !important;
  background: transparent;
  border: none;
  outline: none;
}
```

---

## 代码质量规范

### 源码总目录

- 权威清单：`src/SOURCE_INDEX.md`
- 变更 `src/` 结构时必须同步更新该文件（规则：`.cursor/rules/source-index.mdc`）

### 测试

```bash
# 运行测试
npm test

# 测试框架: node:test (Node.js 内置)
# 测试文件命名: *.test.ts
```

### 测试模式

```ts
import assert from "node:assert/strict";
import test from "node:test";

test("defaults Claude terminal mode to standard", async () => {
  const { resolveClaudeTerminalMode } = await import("./terminalMode.ts");
  assert.equal(resolveClaudeTerminalMode(null), "standard");
});
```

### 构建验证

```bash
# 前端类型检查 + 构建
npm run build

# Rust 后端检查
cargo check
```

---

## 极简自我审查清单

任何前端改造在提交前，必须逐项校验：

1. **[ ] 图标审查**：是否使用了原生 Emoji？是否已换成单色 SVG？
2. **[ ] 颜色审查**：CSS 中是否存在硬编码颜色？是否已换成 CSS 变量？
3. **[ ] 按钮高度审查**：垂直 Padding 是否控制在 3px-5px？Border-radius 是否限制在 4px？
4. **[ ] 镂空审查**：Badge 角标是否使用了镂空隔离设计？
5. **[ ] IME 跟随性**：输入拼音时输入框是否顺畅跟随光标？
6. **[ ] 多主题盲测**：切换所有主题后，元素是否完美适配？

---

## 禁止模式汇总

| 禁止行为 | 正确做法 |
|----------|----------|
| 使用原生 Emoji 作为 UI 图标 | 使用单色 SVG 图标 |
| 硬编码颜色值 (`#fff`, `#000`) | 使用 CSS 变量 `var(--xxx)` |
| 按钮过大、过厚 | Padding 3px-5px, radius 4px |
| 通过改变字重/位置表达状态 | 仅改变颜色和背景 |
| Badge 直接叠加 | 使用镂空隔离设计 |
| 重写 xterm textarea 定位 | 仅通过 z-index 隐藏 |
| 使用 `any` 类型 | 定义具体类型 |
| 忽略 useEffect 清理 | 总是返回清理函数 |
| 增删改 `src/` 模块却不更新总目录 | 同步更新 `src/SOURCE_INDEX.md` 与 barrel |

---

**Language**: All documentation should be written in **English**.
