# Windows 安装器 Document 权限修复

## 失败原因

旧的 `nsis-hooks.nsh` 把 `$USERNAME` 当作 NSIS 运行时变量使用，但没有声明或赋值。NSIS 3.11 编译时产生 `warning 6000: unknown variable/constant`，运行时 `icacls` 收到字面量 `$USERNAME`，返回 1332（账户名称与安全标识间无映射）。即使数据目录已经可写，安装器也会因此中止。

通过 `local-build/nsis-permissions-repro` 中的最小 NSIS 程序复现了上述错误。无需删除 Document 或更改磁盘格式。

## 修复后的行为

- 从当前安装进程的 Windows 令牌读取用户 SID，不依赖用户名、语言或环境变量。
- 当前用户安装：不修改 ACL，检查当前用户实际的目录读取、文件创建、读写和删除权限。
- 所有用户安装：只给 `Document` 授予该 SID 可继承的 Modify 权限，不改动安装根目录的 ACL，不给 Everyone 等组新增权限，不强制启用目录继承。
- 安装进程有 UAC 关联的普通权限令牌时，用普通权限令牌进行检查，避免将管理员能写误认为普通运行时能写。
- 授权命令失败时，只有实际访问检查通过才继续。根目录以及 diary、weekly、monthly、tiles 任意目录检查失败，均明确提示目录与错误原因。
- 检查发生在复制应用程序和写入安装注册信息之前。权限检查不会读取、覆盖或删除已有笔记；测试文件使用 Windows 生成的唯一名称并在关闭时删除。
- 卸载保留 Document 的原有行为不变。

## 安装范围和路径

新安装在具备管理员权限时默认选择所有用户安装，默认目录为系统的 `Program Files\floral-notepaper-regulusapplex`（本机是 `C:\Program Files\floral-notepaper-regulusapplex`）。仍可选择其他盘符和目录。

手动选择当前用户安装时，使用 Windows 用户应用目录，通常为 `%LOCALAPPDATA%\Programs\floral-notepaper-regulusapplex`。普通用户不需要修改 Program Files 的权限。

普通新安装不恢复遗留注册表中的旧路径。显式 `/D=` 路径优先；显式 `/UPDATE` 只有在旧应用主程序和卸载器都存在时才恢复安装位置，并保留相应的用户/系统安装范围。显式 `/CurrentUser`、`/AllUsers` 优先于自动范围判断。

## 回归验证

```powershell
# 在隔离目录运行真正的 NSIS 权限钩子，编译警告视作错误。
pwsh -File scripts/test-nsis-permissions.ps1

# 先生成 Tauri 的 NSIS 脚本与安装包。
npm run build:windows

# 基于实际生成的脚本测试 .onInit；在安装开始前退出。
# 测试使用独立注册表命名空间；本机需管理员终端以验证两种范围。
pwsh -File scripts/test-nsis-startup.ps1
```

权限测试覆盖：当前用户跳过授权、SID 授权、授权失败但目录可写、授权失败且目录只读、当前用户目录只读、用户组拒绝权限、受保护的只读子目录。每项同时检查原笔记文件哈希和安装根目录 ACL 未改变，临时探针文件无残留。

路径测试覆盖：新安装忽略残留路径、当前用户默认目录、显式自定义目录、更新忽略已删除安装、更新保留现有用户安装范围、显式模式优先、新安装不采用现有用户安装路径。测试不会注册或运行实际应用。

2026-09-21 本机结果：权限回归 7/7、路径回归 7/7、前端 163/163、Rust 166/166 通过；TypeScript、lint、Rust 格式检查、本文档格式检查、`git diff --check` 通过；Windows x64 构建和 NSIS 打包成功。安装器将未定义变量警告 6000 视为编译错误，避免再次生成同类问题的安装包。

全量前端格式检查仍报告两处本次修改前已有的问题：`Docs/private-development.md` 和 `src/features/windows/windowRoutes.test.ts`；没有改动这些文件。构建仍有原有的 `SourceHanSerifSC-Bold.woff2` 缺失提示。安装包为未签名的本地构建，未发布到 GitHub。

构建通过不等于真实交互式安装已验收。上述测试覆盖实际权限钩子和初始化逻辑；跨 Windows 账户提权、安装向导操作与正式卸载仍需在相应桌面环境验证。

## 参考

- [NSIS 变量和声明](https://nsis.sourceforge.io/Docs/Chapter4.html#var)
- [Microsoft icacls：数值 SID 需加星号前缀](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)
- [Windows 令牌信息](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-gettokeninformation)
- [使用令牌检查用户权限](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-impersonateloggedonuser)
