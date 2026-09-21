# 花笺 · Floral Notepaper RegulusApplEx

花笺（Floral Notepaper RegulusApplEx）是基于 [Floral Notepaper](https://github.com/Achilng/floral-notepaper) 的独立更新版本。

项目保留原有的 React + Tauri + Rust 架构、Markdown 编辑器、窗口交互、托盘、快捷键、主题和静态资源，并在此基础上完善了笔记目录、日记、周小结、月报和自定义文件夹管理。

> 项目状态：开发中。当前主要面向 Windows x64 使用和构建。

## 功能概览

- Markdown 笔记编辑、预览、保存、重命名、移动和删除。
- 支持导入 Markdown 文件。
- 支持日记、周小结和月报模板。
- 日记按记录日期归档，每天一篇。
- 周小结按 ISO 周归档，每周一篇。
- 月报按记录月份归档，每月一篇。
- 支持新建多级自定义文件夹，并对笔记进行整理。
- 支持磁贴笔记、系统托盘和全局快捷键。
- 日记、周小结和月报在侧栏中按时间分组显示。
- 文件夹支持展开、收起和箭头过渡动画。
- 支持简体中文、繁体中文和英文界面。
- 支持浅色和深色主题。
- 不接入 AI，不使用 Flutter，不自动生成或统计日报、周报、月报。

## 笔记目录

正式安装后，笔记数据默认存放在当前应用程序目录下的 `Document` 文件夹中：

```text
<安装目录>/
├── floral-notepaper-regulusapplex.exe
└── Document/
    ├── metadata.json
    ├── metadata.backup.json
    ├── images/
    ├── diary/
    ├── weekly/
    ├── monthly/
    ├── tiles/
    └── 用户自定义文件夹/
```

默认安装目录为：

```text
C:\\Program Files\\floral-notepaper-regulusapplex\\Document
```

应用设置保存在：

```text
%APPDATA%\\floral-notepaper-regulusapplex\\config.json
```

其中，`config.json` 只保存主题、语言、窗口和快捷键等应用设置；笔记、图片、metadata 和分类目录均保存在 `Document` 中。

卸载应用时默认保留 `Document` 及其中的用户数据。重新安装到同一目录时，不会清空已有数据。

## 周期笔记组织方式

周期笔记仍然是普通 Markdown 笔记，不使用特殊文件格式，也不与模板持续绑定。

```text
日记
└── 2026年第38周
    ├── 09-20 日记
    ├── 09-19 日记
    └── 09-18 日记

周小结
└── 2026年09月
    ├── 第38周 周小结
    └── 第37周 周小结

月报
└── 2026年
    ├── 09月 月报
    └── 08月 月报
```

新建模板时，应用会根据当前语言和日期生成 Markdown 初始内容。创建完成后，笔记可以像普通笔记一样编辑、重命名、移动和删除。

## 技术架构

| 层级         | 技术                       |
| ------------ | -------------------------- |
| 前端界面     | React 19、TypeScript、Vite |
| 桌面容器     | Tauri 2                    |
| 本地后端     | Rust 2021                  |
| Markdown     | React Markdown、GFM、KaTeX |
| 国际化       | i18next、react-i18next     |
| 测试         | Vitest、Rust tests         |
| Windows 打包 | NSIS、Tauri Windows x64    |

主要目录：

```text
src/
├── components/             # 主窗口、编辑器、设置等界面组件
├── features/library/       # 笔记目录树、文件夹和周期管理
├── features/noteTemplates/ # 日记、周小结、月报模板
├── features/notes/         # 笔记创建、读取和保存接口
├── locales/                # 简体中文、繁体中文和英文语言包
└── styles/                 # 主题和界面样式

src-tauri/
├── src/services/notes/     # Rust 笔记文件和 metadata 逻辑
├── src/lib.rs              # Tauri 命令和应用初始化
├── icons/                  # 应用图标和托盘资源
└── *.nsh                   # Windows 安装器脚本
```

## 开发环境

推荐使用 VS Code 作为编辑器。

Windows 开发需要：

- Node.js 20.19+ 或 22.12+。
- Rust stable 工具链和 `x86_64-pc-windows-msvc` 目标。
- Visual Studio 2022 Build Tools 中的 C++ 工具链。
- Windows SDK。
- WebView2 Runtime（Windows 11 和较新的 Windows 10 通常已内置）。

不需要安装完整的 Visual Studio IDE。

## 本地开发

在项目根目录执行：

```powershell
npm ci
npm run tauri -- dev
```

如果只需要启动前端 Vite 开发服务器，可以执行：

```powershell
npm run dev
```

## 测试与检查

```powershell
npm test
npx tsc --noEmit
npm run lint
npx oxfmt --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
cargo fmt --manifest-path src-tauri/Cargo.toml --check
git diff --check
```

## Windows x64 构建

执行：

```powershell
npm run build:windows
```

该命令会执行前端构建、Rust release 构建，并生成 Windows x64 NSIS 安装包。安装包通常位于：

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

`node_modules`、`dist`、`src-tauri/target`、`src-tauri/gen`、`local-build` 和安装包文件均属于可再生成内容，已通过 `.gitignore` 排除，不应提交到仓库。

## 相关文档

- [私有版本开发说明](Docs/private-development.md)
- [笔记目录与周期管理](Docs/note-library.md)
- [本机验收记录](Docs/private-validation.md)
- [贡献指南](CONTRIBUTING.md)
- [第三方声明](THIRD_PARTY_NOTICES.md)

## 项目边界

- 不修改 `floral-notepaper-main` 和 `SpringNote-main`。
- 不嵌入 SpringNote 的 Flutter 工程。
- 不接入 AI 服务。
- 不自动迁移或读取原版 Release 的用户数据。
- 不生成独立的 `reports` 目录。
- 不改变 Markdown 笔记格式和现有编辑器工作方式。

## 许可证

本项目沿用 MIT 许可证，详见 [LICENSE](LICENSE)。

项目来源：[Achilng/floral-notepaper](https://github.com/Achilng/floral-notepaper)
