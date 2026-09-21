# 本机验收记录

后续的侧栏与浅深色主题改造见 [视觉改造验收](ui-theme-validation.md)。下文保留此前周期管理版的安装验收与当时安装包哈希；同名构建产物已由视觉改造版更新。

日期：2026-09-20。工程：`floral_notepaper_regulusapplex`。本记录更新为多级目录与周期管理版，取代此前仅有模板菜单的验收状态。

## 自动化检查

- `npm test`：30 个文件、159 项前端测试通过。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`：165 项 Rust 单元测试通过；主程序与文档测试各 0 项，通过。
- `npx tsc --noEmit`、`npm run lint`、`cargo fmt --check`、新增与修改前端文件的格式检查、`git diff --check` 通过。
- Rust 测试使用进程级 `NO_PROXY=127.0.0.1,localhost`，防止代理接管本地测试服务。
- 新测试覆盖 ISO 跨年／跨月、无效周期、十二个并发创建请求的唯一性、补记与冲突拒绝、目录嵌套与整树移动、空目录删除保护、相对图片移动保护、路径越界与 Windows junction、索引损坏恢复、已登记文件外部移动／编辑／删除前定位，以及创建时间不因编辑而改变。
- 前端测试覆盖三语言历史周期模板、实际目录与周期树、去重计数、目录选择与展开独立、周期登记默认不移动、冲突提示、重复提交保护、取消与父目录候选过滤。

## 安装与隔离

本次数据目录改造的目标路径为当前安装目录下的 `Document`，不是用户“文档”目录。安装器创建 `Document` 及四个系统根目录，并只给当前用户授予该目录的修改权限；卸载时保留 `Document`。

- 本机使用独立 Visual Studio 2022 Build Tools、MSVC x64/x86 与 Windows SDK 10.0.26100.0；未安装完整 Visual Studio IDE。
- `npm run build:windows` 成功生成 NSIS Windows x64 release 安装包。
- 最终安装器以 `/S /CURRENTUSER /UPDATE` 安装，返回码为 0。
- 安装位置：`C:\Users\Regulus\AppData\Local\Programs\floral-notepaper-regulusapplex`。已安装程序 PE Machine 为 `0x8664`。
- 安装阶段应创建安装目录下 `Document` 中的 diary、weekly、monthly、tiles；重装不得覆盖 `Document` 中的测试数据。
- 开始菜单位置：`floral-notepaper-regulusapplex\花笺`。
- 原版 `C:\Program Files\花笺\floral-notepaper.exe` SHA-256 在安装前后保持为 `A049C4084D399FD326E62E97D4C5095225B96DFF4050725BA4432A5D99A67FCD`；原版进程仍运行，卸载记录和“花笺”自启动项未改写。
- 与 floral-notepaper-main 对比，`src/assets` 和 `src-tauri/icons` 文件哈希差异数为 0；两个参考工程未修改。
- 未执行 Git 初始化、提交、推送或 Release 发布。

## 安装版桌面实测

使用独立验收路径，不向正式笔记目录写入测试内容。

1. 空白数据启动显示 0 篇笔记与四个系统目录。
2. 简体界面创建 `2026-09-20 日记`，进入 `diary/2026/2026-W38`，模板章节正确。
3. 编辑正文并保存；退出测试进程、安装更新、重新启动后，标题、正文、创建时间和周期保留。
4. 新建真实多级目录 `验收/学习`，选择该目录后创建空白笔记，实际文件和 category 均位于该目录。
5. 将日记移动到 `验收/学习`；周期视图仍可找到同一笔记并显示新位置，正文不变。
6. 再次创建同一天日记，打开原 ID、原正文，笔记数量没有增加。
7. 切换繁体中文，创建 `2026-W38 週小結`，章节为本週完成／本週問題／下週計劃／復盤，实际目录为 `weekly/2026/09`。
8. 切换英文，创建 `2026-09 Monthly Report`，英文标题及四个章节正确，实际目录为 `monthly/2026`。
9. 语言切换没有改写此前中文日记和繁体周小结。
10. 快捷便签输入、保存后进入 `tiles`，类型为 ordinary。钉为磁贴后笔记总数、ID 和 Markdown 文件名保持不变；关闭磁贴后数据仍保留。
11. 核对 5 篇验收笔记的实际文件均存在，主索引和备份各登记 5 篇。
12. 最终构建安装完成后，退出验收实例，以正常环境启动正式实例。确认配置语言 zh-CN、数据目录为当前安装目录下的 `Document`，metadata 中笔记数及四个系统目录文件数均为 0；窗口显示“0 篇笔记”。

桌面验收发现并修复了新建文件夹输入框失焦过早关闭的问题；上层目录计数也调整为包含子目录并按 ID 去重。

## 最终安装包

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/花笺_1.2.0_x64-setup.exe
大小：19,169,282 bytes
SHA-256：8130F1072EC26633F1BCD4F99BC49103A4AC7D1B07753FD2629BE14193D70E06
```

安装包未签名；没有发布到 GitHub。安装完成后已打开正式空白数据实例。

## 验证边界与已知事项

- 以上列出的核心桌面流程已实测，不代表对所有原版功能完成了穷尽人工回归。文件夹改名／移动、旧笔记登记／周期冲突、删除保护、图片相对路径拒绝和跨年边界主要由自动化测试覆盖。
- 日期／周／月选择器使用系统 WebView 原生控件，其显示格式可能跟随 Windows 语言和区域设置；模板正文使用应用语言。
- 原始源码缺少 `src/assets/fonts/SourceHanSerifSC-Bold.woff2`，构建仍有相同警告。本次保持原资源，不补换字体；该警告不阻止打包。
- 同时运行原版与新版时，全局快捷键可能被原版占用。使用新版快捷键前可退出旧版，或在新版设置不同按键。本次未修改旧版设置，也未关闭原版进程。
- 索引与备份同时损坏时只保护原文件并报错，不自动猜测文件归属。外部改名删除 ID 前缀、存在多个 ID 候选时，需要人工恢复或显式导入。

## 保留的验收数据

```text
local-build/library-smoke-20260920/config
local-build/library-smoke-20260920/data
```

当前正式实例不使用上述路径。5 篇测试笔记保留在验收目录，不自动迁移至正式目录；此前 `local-build/smoke-20260920` 也未清空或删除。
