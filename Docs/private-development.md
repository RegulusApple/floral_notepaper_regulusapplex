# 花笺私有版本开发说明

本工程为 `floral_notepaper_regulusapplex`，基于 Floral 的 React + Tauri 2 + Rust 架构。用户可见名称仍为花笺／花箋／Floral Notepaper，沿用原图标、字体、主题及界面布局。两个参考工程不作修改。

## 模板实现

- 主窗口原“新建笔记”入口增加空白笔记、日记、周小结、月报菜单。
- `src/features/noteTemplates/templates.ts` 生成标题与 Markdown；`NewNoteMenu.tsx` 负责菜单、键盘操作及防重复提交。
- MainWindow 先保存当前笔记，保存失败则中止切换。空白笔记使用当前可写目录；周期笔记先选择日期，再经 `notes_create_period` 创建或打开已有记录，并按记录日期归档。
- 模板只复制一次，落盘仍是普通 `.md` 与原 `metadata.json`；可以编辑、重命名、移动、删除。同一期重复创建不会覆盖已有笔记。
- 日期采用本机日历日期。周小结使用 ISO 周数及 ISO 周年，例如 2021-01-01 属于 2020-W53。
- 三种语言包提供全部菜单、标题和章节文本。改变界面语言仅影响之后新建的内容，不改写现有笔记。
- 不包含 AI、Flutter、自动生成、定时任务、统计聚合或独立 reports 目录。

多级真实目录、周期唯一性、旧笔记登记、磁贴目录及索引恢复详见 [笔记目录与周期管理](note-library.md)。

## 与原 Release 隔离

| 项目                                  | 私有版本                                             |
| ------------------------------------- | ---------------------------------------------------- |
| 应用标识                              | `com.regulusapplex.floral.notepaper`                 |
| 可执行文件                            | `floral-notepaper-regulusapplex.exe`                 |
| Windows 配置                          | `%APPDATA%\floral-notepaper-regulusapplex`           |
| 默认笔记、metadata、图片及背景        | Windows“文档”目录下的 `花笺-RegulusApplEx`           |
| 手动更换数据目录                      | 所选目录下的 `floral-notepaper-regulusapplex` 子目录 |
| NSIS 安装目录、卸载注册表键、自启动项 | `floral-notepaper-regulusapplex`                     |
| 开始菜单                              | `floral-notepaper-regulusapplex\花笺`                |

首次运行不扫描或迁移旧版数据。目标数据目录非空时，手动搬迁会拒绝覆盖。测试可通过 `FLORAL_NOTEPAPER_REGULUSAPPLEX_CONFIG_DIR` 和 `FLORAL_NOTEPAPER_REGULUSAPPLEX_DATA_DIR` 同时指定一套独立路径。

安装器保留显示名称“花笺”，但使用独立内部标识；不识别／卸载同名的原版 WiX 安装，不改写 Markdown/TXT 文件关联，也不覆盖已有桌面“花笺”快捷方式。可从上表的独立开始菜单启动新版。原版和新版可并存，但同时运行时同一全局快捷键只能被其中一个应用注册；使用新版快捷键时请退出旧版或在新版设置不同按键。

原项目 GitHub / MirrorChyan 更新通道暂时禁用（前端和 Rust 均有保护），设置页显示说明。私有发布机制确认之前只使用本项目构建的安装包更新。源项目链接与贡献者信息仍保留作为来源说明。

## Windows x64 开发与构建

本机使用 VS Code；只需 Visual Studio 2022 Build Tools 的 C++ 工具链与 Windows SDK，不需要完整 Visual Studio IDE。本次已安装 MSVC x64/x86 Build Tools 和 Windows 11 SDK 10.0.26100.0；Rust 使用 `x86_64-pc-windows-msvc`。

在项目根目录执行：

```powershell
npm ci
npm test
npx tsc --noEmit
npm run lint

# 防止 HTTP 代理接管单元测试使用的本地地址；只影响当前终端。
$env:NO_PROXY = '127.0.0.1,localhost'
cargo test --manifest-path src-tauri/Cargo.toml --locked

npm run build:windows
```

`build:windows` 执行 Tauri 的 Windows x64 release + NSIS 打包，产物位于：

```text
src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/
```

当前构建不签名，Windows 可能提示未知发布者；正式分发前应另外配置代码签名。不要上传本地数据、凭据、`node_modules`、`target` 或安装包到源码仓库。这次开发不执行 Git 提交或推送。

安装器使用来自 Tauri CLI 2.10.1 的自定义模板 `src-tauri/installer-private.nsi`，许可证保留在同目录的 `installer-private.LICENSE`。升级 CLI 时需重新审查安装路径、注册表、快捷方式与模板变量兼容性，不能直接替换回默认模板。

## 验证范围

自动化测试覆盖三语言模板、ISO 跨年和本地日期、空白笔记、菜单点击与键盘操作、防重复提交、普通笔记存储／重新读取／修改／移动／删除、非空目标目录保护、更新通道禁用和安装器隔离约束。

桌面验收使用独立测试配置与数据目录，避免测试笔记进入用户的正式空白数据目录。具体本机运行结果见同目录的验收记录。

原始源码缺少并忽略了 `src/assets/fonts/SourceHanSerifSC-Bold.woff2`，Vite 会提示该引用未解析。本次未替换原字体资源，其他现有字体保留；该警告不阻止打包，但缺失字体无法声称已完整验证。
