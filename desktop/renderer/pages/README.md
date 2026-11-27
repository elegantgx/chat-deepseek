# desktop/renderer/pages — 四个管理页面

页面只往纸面里画内容：外壳（侧栏玻璃 + 纸面板）由 `../app/frame` 提供，页面不要重复实现。

## 约定

- 一个页面一个目录：`<id>/index.tsx` 命名导出 `XxxPage`，样式放 `<id>/*.module.css`。
  页面多就再拆文件，但都留在自己的目录里。
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

页面只通过 `../app` 的 `useRequest` / `useHost` / `useHostEvent` 取数，字段类型在 `../app/ipc-types.ts`，
方法契约见 `docs/ipc.md`。**不要再写 fixtures**：`../app/mock-host.ts` 就是浏览器里的后端替身，
它按同一份契约返回数据，所以页面不需要知道自己连的是真后端还是替身。

| 页面 | 方法                                                                                                        |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| 服务 | `system.status`、`service.start/stop/restart`、`service.logs`、`desktop.openUrl` + 事件 `event.service.log` |
| 账户 | `auth.whoami`、`auth.login`、`auth.logout`、`account.list/add/password/delete`                              |
| 备份 | `system.status`、`backup.list/create/restore/delete`                                                        |
| 设置 | `config.get`、`config.set`、`system.status`、`service.install/uninstall`、`desktop.dataDir(.set)`           |

约定：

- 服务页的「打开页面」由 `system.status.service.listen`（`host:port`）推导，`0.0.0.0` / `::` /
  `[::]` / 空 host 回落 `127.0.0.1`；`desktop.openUrl` 只接受 http/https。
- 自动打开只在用户点「启动服务」且进入 `running` 后触发一次；页面加载时服务本来就在跑不自动弹浏览器。
- 设置页安装对话框的 `service.install({ force, enable })` 结果带 `warnings`，必须留在对话框里展示
  （例如 linger 未开启），不能只弹 Toast 就关掉；`system.status.service.linger` 决定 linger 文案与命令。
- 服务页的主操作只看 `system.status.service.state`：`running` → 重启/停止，`stopped` → 启动，
  `unknown` → 禁用。没装 systemd 也能启停（ipc 会托管本地 `serve` 子进程），所以 `installed` /
  `supported` 不参与按钮判断；安装 systemd 用户单元是设置页的高级功能。
- `system.status.service.mode` 与 `state` 正交，只用来展示「管理方式」：`systemd` →「systemd 用户单元」，
  `process` →「桌面端本地进程」，`none` → stopped 时「未运行」、否则占位「—」。
  `installed` 仍表示 unit 是否存在，`supported` 仍表示平台有没有 systemd，两者都不阻塞启停。
- 读失败要显示错误说明 + 重试，不能把空数据显示成空态；真正的空列表才用 `ui/EmptyState`。
- 写操作失败统一走 `normalizeHostError`，用 Toast 显示 `message`（`code` 只做分支判断）。
- 写成功后 `reload()` 相关读请求；真后端里写方法是串行的，且并发顺序不保证，所以一次只允许一个在途操作。
- 页面不读 `window.location.hash`。替身支持的 `-off` / `empty` / `login` / `setup` / `statuserr` /
  `-systemd` / `-linger` 后缀在 `app/mock-host.ts` 里处理；`-uninstalled` 只是默认本地态的显式别名。
  页面只管渲染后端给的数据。

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
