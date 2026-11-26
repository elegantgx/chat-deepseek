# desktop/renderer/pages — 四个管理页面

页面只往纸面里画内容：外壳（侧栏玻璃 + 纸面板）由 `../app/frame` 提供，页面不要重复实现。

## 约定

- 一个页面一个目录：`<id>/index.tsx` 命名导出 `XxxPage`，本页的样本数据放 `<id>/fixtures.ts`，
  样式放 `<id>/*.module.css`。页面多就再拆文件，但都留在自己的目录里。
- 页面结构固定为：

  ```tsx
  <PageHead title="服务" actions={…} />
  <PageBody>…</PageBody>
  ```

  两者都从 `../../app` 引入；`PageBody` 已经处理左右 32 留白、底部 28、纵向 16 间距与剩余高度。

- 颜色 / 字号 / 间距 / 圆角只能用 `../../ui` 的组件和 `--*` 变量；**不写裸色值、不新造 token、
  不引第三方库、不加图标库**（需要新图标就和设计系统一起加）。
- 内容层永远不透明；玻璃只出现在侧栏、对话框、Toast（`ui` 已经按这条实现）。
- 文案用中文。桌面端 v1 不做多语言，`src/` 的 zh/en 不适用这里。

## 数据

这一波先用样本：`fixtures.ts` 里按 `../app/ipc-types` 的类型写死，字段名与 `internal/ipc` 的 JSON 完全一致。
接真后端在下一波，届时只替换数据来源（`window.host.request(...)`），视图不动。

| 页面 | 要用的方法                                                                               | 类型                                                                         |
| ---- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 服务 | `system.status`、`service.start/stop/restart`、`service.logs` + 事件 `event.service.log` | `SystemStatus`、`ServiceStartResult`、`ServiceLogsResult`、`ServiceLogEvent` |
| 账户 | `auth.whoami`、`auth.login`、`auth.logout`、`account.list/add/password/delete`           | `AuthState`、`AccountList`、`AccountRow`                                     |
| 备份 | `system.status`、`backup.list/create/restore/delete`                                     | `SystemStatus`、`BackupList`、`BackupCreated`、`BackupRestored`              |
| 设置 | `config.get`、`config.set`、`system.status`、`service.install/uninstall`                 | `ConfigProjection`、`SystemStatus`                                           |

写操作在真后端里有互斥与顺序限制（见 `docs/ipc.md` §2），所以样本阶段就要按「一次一个操作、
操作中禁用按钮」组织交互，不要写并发提交。

## 视觉验收

视觉规范见 `docs/desktop-visual.md`；定稿效果图在 `tmp/visual/proposal/`（本地过程稿，不入库）：

- 服务：`01-service-light.png`、`05-service-dark.png`
- 账户：`02-accounts-light.png`
- 备份：`03-backup-light.png`、`06-backup-dark.png`
- 设置：`04-settings-light.png`
- 组件与状态样张：`07-components.png`

hash 既是页面路由也是截图参数：`#service`、`#backup-dark`、`#settings-light`。

```sh
./node_modules/.bin/rspack build -c desktop/rspack.config.ts
google-chrome --headless=new --no-sandbox --hide-scrollbars --disable-gpu \
  --user-data-dir="$PWD/tmp/chrome-profile" \
  --force-device-scale-factor=2 --window-size=1280,800 \
  --screenshot="$PWD/tmp/service-light.png" \
  "file://$PWD/desktop/dist/renderer/index.html#service"
```

截图是 2560×1600（1280×800 @2x）；对照效果图看留白、行高、字号、分隔线和状态色，不看像素差工具。

## 不要动

`ui/`（设计系统）、`app/`（外壳与契约）、`pages/index.ts`（注册表）、别的页面目录、
`desktop/main.ts` / `preload.ts`、根 `package.json` 与依赖。

## 门禁

在仓库根跑，全绿才算完：

```sh
./node_modules/.bin/tsc -p desktop/tsconfig.json --noEmit
./node_modules/.bin/oxlint desktop/renderer
./node_modules/.bin/oxfmt --check desktop/renderer
```
