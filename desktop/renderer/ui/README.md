# desktop/renderer/ui — 桌面端设计系统

视觉规范见 `docs/desktop-visual.md`（已定稿），本目录是它的代码实现：

- `tokens.css` 是唯一的颜色 / 尺寸来源，值取自定稿规范；为组件层补了几个 token（`--nav-hover`、
  `--scrim`、`--on-accent`、`--knob`、`--gloss`、`--gloss-strong`、`--accent-shadow`、
  `--seg-thumb-ring`），没有新增视觉决策。
- 组件只吃 props，不做业务判断；颜色 / 字号 / 间距 / 圆角 / 阴影全部走 CSS 变量。
- 不引第三方库；图标是内联 SVG（24 网格、1.5 描边、round cap），随 `icons.tsx` 一起发。
- 每个组件一个 `.tsx` + 同名 `.module.css`；统一从 `./index` 导入。

## 引入

```ts
import { Button, Card, CardHeader, Field, Table, type TableColumn } from '../ui'
```

`ui/index.ts` 会顺带引入 `tokens.css` 与 `global.css`（元素 reset + `.cd-sr-only`），页面不需要再单独引。

## 组件

| 组件                                       | 主要 props                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Button`                                   | `tone?: 'primary' \| 'secondary' \| 'danger' \| 'dangerSolid'`、`size?: 'md' \| 'sm'`、`icon?: ReactNode` + 原生 button 属性；禁用用 `disabled`                                      |
| `TextButton`                               | `tone?: 'accent' \| 'quiet' \| 'danger'`、`icon?: ReactNode`；用于「清屏 / 改密码 / 查看全部」这类链接式操作                                                                         |
| `Field`                                    | `label`、`value`、`onChange?`、`type?: 'text' \| 'password'`、`readOnly?`、`disabled?`、`invalid?`、`error?`、`hint?`、`mono?`、`fullWidth?`、`autoFocus?`；不传 `onChange` 视作只读 |
| `Toggle`                                   | `checked`、`onChange?`、`label`（无障碍名）、`disabled?`；渲染 `<button role="switch">`                                                                                              |
| `Segmented`                                | `options: {value,label,disabled?}[]`、`value`、`onChange?`、`label`、`width?`；radiogroup 语义 + 左右方向键                                                                          |
| `StatusPill`                               | `status: 'running' \| 'stopped' \| 'error'`、`label?`                                                                                                                                |
| `Badge`                                    | `children`                                                                                                                                                                           |
| `Card` / `CardHeader` / `CardFooter`       | `grow?`、`clip?`；header 为 `title/meta/actions`，footer 为 `children/end`                                                                                                           |
| `Table`                                    | 泛型：`columns`（`key/header/width/align/render`）、`rows`、`rowKey`、`actions?`（`header/width/render`）、`empty?`、`caption?`                                                      |
| `Sidebar` / `SidebarBrand` / `SidebarItem` | `brand`、`children`、`footer`；item 为 `icon/label/active/onClick/disabled`                                                                                                          |
| `Paper`                                    | `children`；左上 12px 圆角 + 顶/左 1px 轮廓，高度由页面控制                                                                                                                          |
| `Dialog`                                   | `open`、`title`、`description?`、`children?`、`actions?`、`onClose?`、`size?: 'md' \| 'sm'`、`variant?: 'overlay' \| 'contained'`                                                    |
| `Toast`                                    | `tone: 'success' \| 'error'`、`children`；自动消失由页面负责                                                                                                                         |
| `EmptyState`                               | `title`、`description?`、`icon?`、`action?`、`compact?`                                                                                                                              |
| `LogPane`                                  | `lines`（`time/level/message/id?`）、`title?`、`count?`、`onClear?`、`footerAction?`、`emptyText?`、`height?`                                                                        |

无障碍约定：按钮都是真 `<button>`，Field 用 `useId` 关联 label / 错误文案，输入聚焦有可见环，
Dialog 有 `role="dialog"` + `aria-modal`（overlay）+ Esc 关闭，Segmented 是 radiogroup。

## 组件总览

`desktop/renderer/gallery/` 是独立入口，构建后打开：

```sh
./node_modules/.bin/rspack build -c desktop/rspack.config.ts
google-chrome --headless=new --no-sandbox --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=1280,800 \
  --screenshot=tmp/gallery-light.png \
  file://$PWD/desktop/dist/renderer/gallery.html
```

哈希控制初始状态：`#dark` 深色、`#density` 纸面视图、`#dark-density` 深色纸面视图；页面右上角也能切。
默认视图按 12 列栅格排布，纸面视图演示 `Paper + Card + Table + LogPane`。

## 与定稿效果图的偏差

效果图是过程稿，不入库；以下是实现时按 CSS / 规范做的取舍：

- 按钮高 32：效果图的画布标注写「高 30」，实际 `.btn` 是 32，按 CSS 实现。
- Field 的 label 用 12/18 次级文字色：效果图输入框上方那行 11px 灰字是画布标注，不是字段标签。
- Paper 只有 1px 轮廓、没有 `box-shadow`：定稿的纸面板未定义投影，纸面左侧的落影来自侧栏
  `--glass-edge-shadow`。要加投影需要新 token 与视觉确认。
- Dialog 的 `contained` 变体只用于总览样例（`left:40% + margin`），产品页面用 `overlay` 居中。
- 总览页没有「列表行」样例（那不是本套组件），该格换成了 Card 的 header/footer 样本。

## 已知缺口

- Dialog 只有初始聚焦 + Esc，**没有焦点陷阱**：Tab 还能跑到背景上。真实页面接入前要补。
- Toast 不带定时器，3 秒自动消失由页面调度。
