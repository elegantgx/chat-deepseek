# 第三方资源说明

## DeepSeek 鲸鱼标志

`src/components/base/WhaleLogo.tsx`、`src/assets/favicon.svg`，以及 `desktop/build/whale.svg` 和由它渲染的 `desktop/build/whale.png`、`desktop/build/whale.ico`、`desktop/build/whale.icns` 中的鲸鱼路径来自
[Simple Icons 的 deepseek 图标](https://github.com/simple-icons/simple-icons/blob/develop/icons/deepseek.svg)。

- `desktop/build/` 下的图标文件由 `gui/assets/` 迁移而来，与已删除的 PySide6 外壳使用同一份 CC0 素材。
- Simple Icons 以 [CC0-1.0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md) 发布。
- DeepSeek 名称和鲸鱼标志是 DeepSeek 的商标/品牌资产；本项目仅用其标识与 DeepSeek 服务的兼容性，与 DeepSeek 官方无隶属关系。

## Electron / Chromium

桌面端安装包分发 Electron 运行时与 Chromium；包内已随附 `LICENSE.electron.txt` 与 `LICENSES.chromium.html`，本节只做汇总，完整文本以包内文件为准。

- Electron：MIT，版权归 Electron contributors（OpenJS Foundation）；许可证文本见 [Electron 的 LICENSE](https://github.com/electron/electron/blob/main/LICENSE)。
- Chromium：BSD 3-Clause，版权归 The Chromium Authors；许可证文本见 [Chromium 的 LICENSE 页面](https://www.chromium.org/developers/how-tos/license/)。

## DM Sans

`src/assets/fonts/DMSans-700.woff2` 用于 `Deepseek` 字标，来自
[Google Fonts 的 DM Sans](https://fonts.google.com/specimen/DM+Sans)。

- Copyright 2014 The DM Sans Project Authors。
- 以 [SIL Open Font License 1.1](https://openfontlicense.org/) 发布；许可证全文见 `src/assets/fonts/OFL.txt`，构建后也会复制为 `DMSans-OFL.txt`。
- 官方 DeepSeek 字标是定制字形，不能公开使用；这里用官方界面字体 DM Sans 做近似，并把首字母改为大写 `D`。
