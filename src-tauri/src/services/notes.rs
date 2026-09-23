use crate::json_io::write_json_atomic;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fmt, fs, io,
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use uuid::Uuid;

mod library;
use library::STORAGE_LOCK;
static CONFIG_LOCK: Mutex<()> = Mutex::new(());
pub use library::{PeriodNoteRequest, RecordType};

#[cfg(target_os = "macos")]
const DEFAULT_MACOS_GLOBAL_SHORTCUT: &str = "Command+Option+N";
#[cfg(target_os = "macos")]
const LEGACY_MACOS_GLOBAL_SHORTCUTS: [&str; 5] = [
    "Option+Space",
    "Alt+Space",
    "Ctrl+Option+Space",
    "Control+Option+Space",
    "Ctrl+Alt+Space",
];
const MACOS_SHORTCUT_MIGRATION_MARKER: &str = ".macos-shortcut-default-v3";

pub fn take_data_migration_notice() -> bool {
    // Keep the existing IPC contract; startup no longer migrates data.
    false
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_locale")]
    pub locale: String,
    // 读入时可缺省（旧 config 无此字段），但返回前端前必在 load_config / save_config
    // 中被设为 Some。不加 skip_serializing_if：保证 dataDir 字段始终序列化输出，
    // 与前端 `dataDir: string` 契约一致，避免 None 时省略字段导致前端收到 undefined
    #[serde(default)]
    pub data_dir: Option<String>,
    pub global_shortcut: String,
    pub close_to_tray: bool,
    pub autostart: bool,
    pub default_view_mode: String,
    #[serde(default = "default_note_auto_save")]
    pub note_auto_save: bool,
    #[serde(default = "default_note_surface_auto_save")]
    pub note_surface_auto_save: bool,
    #[serde(default = "default_tile_color")]
    pub tile_color: String,
    #[serde(default = "default_tile_color_mode")]
    pub tile_color_mode: String,
    #[serde(default = "default_tile_style")]
    pub tile_style: String,
    #[serde(default = "default_tile_appearance")]
    pub tile_appearance: String,
    #[serde(default, deserialize_with = "deserialize_tile_opacities")]
    pub tile_opacity_by_note_id: BTreeMap<String, f64>,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_surface_font_size")]
    pub surface_font_size: u32,
    #[serde(default = "default_tab_indent_size")]
    pub tab_indent_size: u32,
    #[serde(default = "default_external_file_auto_save")]
    pub external_file_auto_save: bool,
    #[serde(default)]
    pub background_image_path: String,
    #[serde(default = "default_background_fit")]
    pub background_fit: String,
    #[serde(default = "default_background_dim")]
    pub background_dim: f64,
    #[serde(default = "default_background_blur")]
    pub background_blur: f64,
    #[serde(default = "default_background_scale")]
    pub background_scale: f64,
    #[serde(default = "default_background_position")]
    pub background_position_x: f64,
    #[serde(default = "default_background_position")]
    pub background_position_y: f64,
    #[serde(default = "default_remember_surface_size")]
    pub remember_surface_size: bool,
    #[serde(default = "default_tile_ctrl_close")]
    pub tile_ctrl_close: bool,
    #[serde(default)]
    pub tile_double_click_to_edit: bool,
    #[serde(default)]
    pub tile_save_returns_to_pin: bool,
    #[serde(default)]
    pub tile_render_markdown: bool,
    #[serde(default)]
    pub render_html_markdown: bool,
    #[serde(default = "default_split_scroll_sync")]
    pub split_scroll_sync: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_width: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surface_height: Option<u32>,
    #[serde(default = "default_toggle_visibility_shortcut")]
    pub toggle_visibility_shortcut: String,
    #[serde(default = "default_todo_shortcut")]
    pub todo_shortcut: String,
    #[serde(default = "default_open_at_cursor")]
    pub open_at_cursor: bool,
    // Legacy fields — read from old config, never written back
    #[serde(default, skip_serializing)]
    pub notes_dir: Option<String>,
    #[serde(default, skip_serializing)]
    pub last_known_base_dir: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SaveNoteRequest {
    pub title: String,
    pub content: String,
    #[serde(default)]
    pub category: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteMetadata {
    pub id: String,
    pub title: String,
    pub file_name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub record_type: RecordType,
    #[serde(default)]
    pub record_period: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub word_count: usize,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub id: String,
    pub title: String,
    pub file_name: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub record_type: RecordType,
    #[serde(default)]
    pub record_period: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub word_count: usize,
    pub content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub details: BTreeMap<String, String>,
}

impl AppError {
    fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: BTreeMap::new(),
        }
    }

    fn with_detail(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.details.insert(key.into(), value.into());
        self
    }

    fn note_not_found(id: &str) -> Self {
        Self::new("noteNotFound", format!("Note {id} was not found")).with_detail("noteId", id)
    }

    fn unsupported_file() -> Self {
        Self::new("unsupportedFile", "只支持导入 .md 文件")
    }

    fn category_name_empty() -> Self {
        Self::new("categoryNameEmpty", "分类名不能为空")
    }

    fn category_name_invalid_chars() -> Self {
        Self::new("categoryNameInvalidChars", "分类名不能包含特殊字符")
    }

    fn category_not_found(name: &str) -> Self {
        Self::new("categoryNotFound", format!("分类「{name}」不存在")).with_detail("category", name)
    }

    fn category_already_exists(name: &str) -> Self {
        Self::new("categoryAlreadyExists", format!("分类「{name}」已存在"))
            .with_detail("category", name)
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for AppError {}

impl From<io::Error> for AppError {
    fn from(error: io::Error) -> Self {
        Self::new("io", error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new("json", error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::new("tauri", error.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct MetadataFile {
    notes: Vec<NoteMetadata>,
}

#[derive(Debug, Clone)]
pub struct NoteStore {
    config_dir: PathBuf,
    data_dir: PathBuf,
}

pub fn default_store() -> Result<NoteStore, AppError> {
    let config_dir = default_config_dir()?;
    let data_dir = resolve_data_dir(&config_dir)?;
    Ok(NoteStore::new(config_dir, data_dir))
}

pub(crate) fn default_config_dir() -> Result<PathBuf, AppError> {
    if let Ok(path) = env::var("FLORAL_NOTEPAPER_REGULUSAPPLEX_CONFIG_DIR") {
        let trimmed = path.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }
    if let Some(dir) = dirs::config_dir() {
        return Ok(dir.join("floral-notepaper-regulusapplex"));
    }
    Ok(env::current_dir()?.join("floral-notepaper-regulusapplex"))
}

fn default_data_dir() -> Result<PathBuf, AppError> {
    if cfg!(debug_assertions) {
        if let Ok(path) = env::var("FLORAL_NOTEPAPER_REGULUSAPPLEX_DATA_DIR") {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed));
            }
        }
    }

    // Windows data intentionally follows the installed executable. This keeps
    // a moved/reinstalled copy self-contained while the installer grants write
    // access only to the sibling Document directory.
    #[cfg(target_os = "windows")]
    {
        let executable = env::current_exe()?;
        let executable_dir = executable.parent().ok_or_else(|| {
            AppError::new("dataDir", "无法确定应用程序所在目录")
                .with_detail("executable", executable.display().to_string())
        })?;
        return Ok(executable_dir.join("Document"));
    }

    // Keep the existing non-Windows defaults so this Windows-specific storage
    // change does not make the macOS/Linux bundles write into their app bundle.
    #[cfg(not(target_os = "windows"))]
    {
        #[cfg(target_os = "macos")]
        if let Some(dir) = dirs::data_dir() {
            return Ok(dir.join("花笺-RegulusApplEx"));
        }

        if let Some(dir) = dirs::document_dir() {
            return Ok(dir.join("花笺-RegulusApplEx"));
        }

        return Ok(env::current_dir()?.join("floral-notepaper-regulusapplex-data"));
    }

    #[allow(unreachable_code)]
    Ok(env::current_dir()?.join("floral-notepaper-regulusapplex-data"))
}

fn resolve_data_dir(_config_dir: &Path) -> Result<PathBuf, AppError> {
    if cfg!(debug_assertions) {
        if let Ok(path) = env::var("FLORAL_NOTEPAPER_REGULUSAPPLEX_DATA_DIR") {
            let trimmed = path.trim();
            if !trimmed.is_empty() {
                return Ok(PathBuf::from(trimmed));
            }
        }
    }
    default_data_dir()
}

#[cfg(test)]
fn data_dir_from_notes_dir(notes_dir: &str) -> PathBuf {
    let path = Path::new(notes_dir);
    if path.file_name().and_then(|n| n.to_str()) == Some("notes") {
        if let Some(parent) = path.parent() {
            return parent.to_path_buf();
        }
    }
    path.to_path_buf()
}

// 旧版无论 notesDir 指向哪里，metadata.json、images、backgrounds 都固定存放在旧主目录；
// 数据目录解析到其他位置时必须一并带走，否则笔记内图片引用全部失效、created_at 丢失
#[cfg(test)]
fn migrate_legacy_aux_data(legacy_base_dir: &Path, data_dir: &Path) {
    for item in ["metadata.json", "images", "backgrounds"] {
        let src = legacy_base_dir.join(item);
        let dst = data_dir.join(item);
        if !src.exists() || dst.exists() {
            continue;
        }
        if let Err(error) = move_path(&src, &dst) {
            eprintln!(
                "failed to migrate legacy {item} from {} to {}: {}",
                legacy_base_dir.display(),
                data_dir.display(),
                error.message
            );
        }
    }
}

// v1.0.4 之前没有 ensure_notes_suffix，自定义笔记目录下 .md 直接位于目录顶层、
// 分类是顶层子目录；旧版自定义数据目录的散落笔记在兼容迁移时归位到旧 notes 层
#[cfg(test)]
fn rescue_loose_legacy_notes(legacy_base_dir: &Path, data_dir: &Path) {
    let notes_dir = data_dir.join("notes");
    let tracked = fs::read_to_string(legacy_base_dir.join("metadata.json"))
        .ok()
        .and_then(|content| serde_json::from_str::<MetadataFile>(&content).ok());

    match tracked {
        Some(metadata) => {
            for note in &metadata.notes {
                let (src, dst) = if note.category.is_empty() {
                    (
                        data_dir.join(&note.file_name),
                        notes_dir.join(&note.file_name),
                    )
                } else {
                    (
                        data_dir.join(&note.category).join(&note.file_name),
                        notes_dir.join(&note.category).join(&note.file_name),
                    )
                };
                move_loose_note_file(&src, &dst);
            }
        }
        None => {
            // 旧 metadata 缺失时退化为整层扫描，与旧版重建逻辑一致：所有 .md 均视为笔记
            move_loose_note_files_in(data_dir, &notes_dir);
            let Ok(entries) = fs::read_dir(data_dir) else {
                return;
            };
            for entry in entries.filter_map(|entry| entry.ok()) {
                let path = entry.path();
                if !path.is_dir() {
                    continue;
                }
                let name = entry.file_name().to_string_lossy().to_string();
                // 点前缀目录是 VCS / 应用配置（.git、.obsidian 等），绝非用户分类，
                // 连同保留目录一并跳过，避免把无关目录的 .md 误搬成笔记
                if name.starts_with('.')
                    || matches!(
                        name.as_str(),
                        "notes" | "images" | "backgrounds" | "updates"
                    )
                {
                    continue;
                }
                move_loose_note_files_in(&path, &notes_dir.join(&name));
            }
        }
    }
}

#[cfg(test)]
fn move_loose_note_files_in(from: &Path, to: &Path) {
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("md") {
            continue;
        }
        move_loose_note_file(&path, &to.join(entry.file_name()));
    }
}

// legacy 数据搬运：尽力而为，单个文件失败不中断整体迁移，故吞掉错误。
// 与下方 move_path 的"错误传播"语义刻意相反——调用方需据此选择
#[cfg(test)]
fn move_loose_note_file(src: &Path, dst: &Path) {
    if !src.is_file() || dst.exists() {
        return;
    }
    if let Some(parent) = dst.parent() {
        if fs::create_dir_all(parent).is_err() {
            return;
        }
    }
    if fs::rename(src, dst).is_err() && fs::copy(src, dst).is_ok() {
        let _ = fs::remove_file(src);
    }
}

// 关键路径搬运（aux data / 目录迁移）：失败必须向上传播，
// 与上方 move_loose_note_file 的"静默吞错"语义刻意相反
#[cfg(test)]
fn move_path(src: &Path, dst: &Path) -> Result<(), AppError> {
    if src.is_dir() {
        return move_or_copy_dir(src, dst);
    }
    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent)?;
    }
    if fs::rename(src, dst).is_err() {
        fs::copy(src, dst)?;
        fs::remove_file(src)?;
    }
    Ok(())
}

fn remap_path_prefix(path_str: &str, old_base: &Path, new_base: &Path) -> String {
    if path_str.is_empty() {
        return String::new();
    }
    match Path::new(path_str).strip_prefix(old_base) {
        Ok(relative) => new_base.join(relative).to_string_lossy().to_string(),
        Err(_) => path_str.to_string(),
    }
}

// 仅用于路径比较：解析符号链接并统一表示。Windows 上 fs::canonicalize 返回
// \\?\ verbatim 前缀，而 fallback 分支拿不到该前缀；若一边规范化成功、另一边走
// fallback，starts_with 前缀比较会失配，导致嵌套目录保护被绕过。这里统一剥离
// verbatim 前缀，保证两条路径处于同一表示空间
fn canonical_for_compare(path: &Path) -> PathBuf {
    fn strip_verbatim(path: PathBuf) -> PathBuf {
        let text = path.to_string_lossy();
        if let Some(rest) = text.strip_prefix(r"\\?\") {
            // UNC verbatim 前缀 \\?\UNC\server\share → \\server\share
            if let Some(unc) = rest.strip_prefix(r"UNC\") {
                return PathBuf::from(format!(r"\\{unc}"));
            }
            return PathBuf::from(rest);
        }
        path
    }

    if let Ok(canonical) = fs::canonicalize(path) {
        return strip_verbatim(canonical);
    }
    if let (Some(parent), Some(name)) = (path.parent(), path.file_name()) {
        if let Ok(parent) = fs::canonicalize(parent) {
            return strip_verbatim(parent).join(name);
        }
    }
    path.to_path_buf()
}

// `trash` uses IFileOperation on Windows. Native ARM64 processes launched from
// an MSIX package can fail that COM-backed path with 0x80070002 even though the
// file exists. SHFileOperationW is exported directly by shell32.dll and keeps
// the same Recycle Bin semantics when FOF_ALLOWUNDO is set, without activating
// the failing COM class.
#[cfg(target_os = "windows")]
fn recycle_path(path: &Path) -> Result<(), AppError> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::UI::Shell::{
        SHFileOperationW, FOF_ALLOWUNDO, FOF_NO_UI, FOF_WANTNUKEWARNING, FO_DELETE, SHFILEOPSTRUCTW,
    };

    // Relative paths are not thread-safe with SHFileOperationW. NoteStore
    // normally supplies absolute paths, but keep the platform boundary safe
    // for callers created by tests or environment overrides as well.
    let full_path = if path.is_absolute() {
        path.to_path_buf()
    } else {
        env::current_dir()?.join(path)
    };

    // SHFileOperationW expects a list terminated by an extra NUL, even when it
    // contains only one path.
    let source = full_path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::repeat_n(0, 2))
        .collect::<Vec<_>>();
    let mut operation = SHFILEOPSTRUCTW {
        hwnd: std::ptr::null_mut(),
        wFunc: FO_DELETE,
        pFrom: source.as_ptr(),
        pTo: std::ptr::null(),
        fFlags: (FOF_ALLOWUNDO | FOF_NO_UI | FOF_WANTNUKEWARNING) as u16,
        fAnyOperationsAborted: 0,
        hNameMappings: std::ptr::null_mut(),
        lpszProgressTitle: std::ptr::null(),
    };

    // SAFETY: every pointer in `operation` is either null or points to storage
    // that remains alive for the duration of this synchronous call. `source`
    // has the required double-NUL terminator.
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result != 0 {
        return Err(AppError::new(
            "trash",
            format!("移入回收站失败: Windows Shell 错误 0x{result:08X}"),
        )
        .with_detail("path", full_path.display().to_string())
        .with_detail("windowsCode", format!("0x{result:08X}")));
    }
    if operation.fAnyOperationsAborted != 0 {
        return Err(AppError::new("trash", "移入回收站失败: 操作已取消")
            .with_detail("path", full_path.display().to_string()));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn recycle_path(path: &Path) -> Result<(), AppError> {
    trash::delete(path).map_err(|error| {
        AppError::new("trash", format!("移入回收站失败: {error}"))
            .with_detail("path", path.display().to_string())
    })
}

fn paths_refer_to_same_entry(first: &Path, second: &Path) -> bool {
    if first == second {
        return true;
    }
    match (fs::canonicalize(first), fs::canonicalize(second)) {
        (Ok(first), Ok(second)) => first == second,
        _ => false,
    }
}

#[cfg(test)]
fn known_data_migration_candidates() -> Vec<PathBuf> {
    // This private fork starts empty. Never discover or import release data.
    Vec::new()
}

#[cfg(test)]
fn known_data_migration_candidates_for(
    home: Option<String>,
    userprofile: Option<String>,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(home) = home {
        let home = PathBuf::from(home);
        candidates.push(home.join("Documents").join("花笺-RegulusApplEx"));
        candidates.push(
            home.join("Library")
                .join("Application Support")
                .join("花笺-RegulusApplEx"),
        );
    }
    if let Some(profile) = userprofile {
        let profile = PathBuf::from(profile);
        candidates.push(profile.join("Documents").join("花笺-RegulusApplEx"));
    }

    candidates
}

#[cfg(test)]
fn move_or_copy_dir(from: &Path, to: &Path) -> Result<(), AppError> {
    if fs::rename(from, to).is_ok() {
        return Ok(());
    }
    // cross-filesystem fallback
    if let Some(parent) = to.parent() {
        fs::create_dir_all(parent)?;
    }
    copy_dir_recursive(from, to)?;
    fs::remove_dir_all(from)?;
    Ok(())
}

#[cfg(test)]
fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), AppError> {
    // 拒绝把目录复制进自身子目录：否则递归无限展开、磁盘耗尽。
    // migrate_data_to 上层已用 canonical_for_compare 拦截，这里做底层兜底，
    // 与 updater::helper 的同名实现保持一致的自递归防护
    if to.starts_with(from) && to != from {
        return Err(AppError::new("unsafePath", "目标目录不能位于源目录内部"));
    }
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            fs::copy(entry.path(), &target)?;
        }
    }
    Ok(())
}

fn copy_entry_if_absent(
    source: &Path,
    destination: &Path,
    copied_files: &mut Vec<PathBuf>,
) -> Result<(), AppError> {
    let source_metadata = fs::symlink_metadata(source)?;
    if source_metadata.file_type().is_symlink() {
        return Err(AppError::new(
            "unsafePath",
            format!("数据迁移不支持符号链接: {}", source.display()),
        ));
    }

    if destination.exists() {
        let destination_metadata = fs::symlink_metadata(destination)?;
        if source_metadata.is_dir() && destination_metadata.is_dir() {
            for entry in fs::read_dir(source)? {
                let entry = entry?;
                copy_entry_if_absent(
                    &entry.path(),
                    &destination.join(entry.file_name()),
                    copied_files,
                )?;
            }
            return Ok(());
        }

        // A target file always wins. This is intentionally not a merge or an
        // overwrite operation; the source remains available as a backup.
        eprintln!(
            "data migration conflict, keeping target {} and skipping {}",
            destination.display(),
            source.display()
        );
        return Ok(());
    }

    if source_metadata.is_dir() {
        fs::create_dir_all(destination)?;
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            copy_entry_if_absent(
                &entry.path(),
                &destination.join(entry.file_name()),
                copied_files,
            )?;
        }
    } else if source_metadata.is_file() {
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(source, destination)?;
        copied_files.push(destination.to_path_buf());
    }
    Ok(())
}

fn copy_private_data_layout(source: &Path, destination: &Path) -> Result<(), AppError> {
    let canonical_source = canonical_for_compare(source);
    let canonical_destination = canonical_for_compare(destination);
    if canonical_source == canonical_destination {
        return Ok(());
    }
    if canonical_destination.starts_with(&canonical_source) {
        return Err(AppError::new(
            "unsafePath",
            "新数据目录不能位于旧数据目录内部，请选择其他安装目录",
        ));
    }

    fs::create_dir_all(destination)?;
    let mut copied_files = Vec::new();
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == "config.json" || name == MACOS_SHORTCUT_MIGRATION_MARKER || name == "notes" {
            continue;
        }
        copy_entry_if_absent(
            &entry.path(),
            &destination.join(entry.file_name()),
            &mut copied_files,
        )?;
    }

    // Older private layouts stored categories under notes/. Flatten that one
    // compatibility layer into the new Document root.
    let legacy_notes = source.join("notes");
    if legacy_notes.is_dir() {
        for entry in fs::read_dir(&legacy_notes)? {
            let entry = entry?;
            copy_entry_if_absent(
                &entry.path(),
                &destination.join(entry.file_name()),
                &mut copied_files,
            )?;
        }
    }

    for copied_file in copied_files {
        if !copied_file.is_file() {
            return Err(AppError::new(
                "dataMigration",
                format!("数据迁移校验失败: {}", copied_file.display()),
            ));
        }
    }
    Ok(())
}

fn is_filesystem_root(path: &Path) -> bool {
    let path = path.to_string_lossy();
    let trimmed = path.trim_end_matches(['/', '\\']);
    if trimmed.is_empty() {
        return true;
    }
    // Windows drive root: "C:" or "D:" etc.
    if trimmed.len() == 2 {
        let bytes = trimmed.as_bytes();
        if bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
            return true;
        }
    }
    false
}

fn is_safe_data_dir(path: &Path) -> Result<(), AppError> {
    if is_filesystem_root(path) {
        return Err(AppError::new(
            "unsafePath",
            "不能将磁盘根目录设为数据目录，请选择一个子文件夹",
        ));
    }

    let normalized = path.to_string_lossy().to_lowercase();
    let blocked = [
        "\\windows",
        "\\program files",
        "\\program files (x86)",
        "\\system32",
        "\\syswow64",
    ];
    for suffix in &blocked {
        if normalized.ends_with(suffix) {
            return Err(AppError::new(
                "unsafePath",
                format!("不能将系统目录「{}」设为数据目录", path.display()),
            ));
        }
    }

    let real_components = path
        .components()
        .filter(|c| matches!(c, Component::Normal(_)))
        .count();
    if real_components == 0 {
        return Err(AppError::new(
            "unsafePath",
            "数据目录路径不合法，请选择一个具体的文件夹",
        ));
    }

    Ok(())
}

impl NoteStore {
    pub fn new(config_dir: PathBuf, data_dir: PathBuf) -> Self {
        Self {
            config_dir,
            data_dir,
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn config_dir(&self) -> &Path {
        &self.config_dir
    }

    pub fn metadata_path(&self) -> PathBuf {
        self.data_dir.join("metadata.json")
    }

    pub fn config_path(&self) -> PathBuf {
        self.config_dir.join("config.json")
    }

    #[cfg(target_os = "macos")]
    fn macos_shortcut_migration_path(&self) -> PathBuf {
        self.config_dir.join(MACOS_SHORTCUT_MIGRATION_MARKER)
    }

    pub fn load_config(&self) -> Result<AppConfig, AppError> {
        let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.load_config_unlocked()
    }

    fn load_config_unlocked(&self) -> Result<AppConfig, AppError> {
        self.ensure_config_dir()?;
        let path = self.config_path();
        if !path.exists() {
            let config = self.default_config();
            self.write_config_unlocked(config.clone())?;
            self.mark_macos_shortcut_migration_handled()?;
            return Ok(config);
        }

        let source: serde_json::Value = serde_json::from_str(&fs::read_to_string(&path)?)?;
        let has_todo_shortcut = source.get("todoShortcut").is_some();
        let mut config: AppConfig = serde_json::from_value(source)?;
        // Adding a default must never take a shortcut already chosen for another action.
        if !has_todo_shortcut
            && [
                config.global_shortcut.as_str(),
                config.toggle_visibility_shortcut.as_str(),
            ]
            .iter()
            .any(|shortcut| {
                crate::desktop::shortcut_from_config(shortcut)
                    == crate::desktop::shortcut_from_config(&config.todo_shortcut)
            })
        {
            config.todo_shortcut.clear();
        }
        normalize_tile_config(&mut config);
        // Settings survive reinstalls, but historical dataDir/notesDir values
        // never authorize reading or migrating another installation's data.
        config.data_dir = Some(self.data_dir.to_string_lossy().to_string());
        config.tab_indent_size = config.tab_indent_size.clamp(1, 8);
        write_json_atomic(&path, &config)?;
        self.ensure_library_dirs()?;
        if self.migrate_macos_shortcut_default(&mut config)? {
            write_json_atomic(&path, &config)?;
        }
        Ok(config)
    }

    pub fn save_config(&self, mut config: AppConfig) -> Result<AppConfig, AppError> {
        let _guard = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        // Whole settings snapshots must not overwrite another window's opacity edits.
        config.tile_opacity_by_note_id = self.load_config_unlocked()?.tile_opacity_by_note_id;
        self.write_config_unlocked(config)
    }

    fn write_config_unlocked(&self, mut config: AppConfig) -> Result<AppConfig, AppError> {
        self.ensure_config_dir()?;
        normalize_tile_config(&mut config);
        config.data_dir = Some(self.data_dir.to_string_lossy().to_string());
        config.tab_indent_size = config.tab_indent_size.clamp(1, 8);
        is_safe_data_dir(&self.data_dir)?;
        self.ensure_library_dirs()?;
        write_json_atomic(&self.config_path(), &config)?;
        Ok(config)
    }

    pub fn set_tile_opacity(&self, note_id: &str, opacity: f64) -> Result<AppConfig, AppError> {
        // Lock order is always storage, then config (also used by deletion).
        let _storage = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.find_metadata(note_id)?;
        let _config = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut config = self.load_config_unlocked()?;
        config
            .tile_opacity_by_note_id
            .insert(note_id.to_string(), normalize_tile_opacity(opacity));
        self.write_config_unlocked(config)
    }

    pub fn delete_note(&self, id: &str) -> Result<(), AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        let mut metadata = self.reconcile_metadata()?;
        let index = metadata
            .notes
            .iter()
            .position(|n| n.id == id)
            .ok_or_else(|| AppError::note_not_found(id))?;
        let note = metadata.notes.remove(index);
        let path = self.checked_note_path(&note.file_name, &note.category)?;
        if path.exists() {
            recycle_path(&path)?;
        }
        self.save_metadata(&metadata)?;
        {
            let _config = CONFIG_LOCK.lock().unwrap_or_else(|e| e.into_inner());
            let mut config = self.load_config_unlocked()?;
            if config.tile_opacity_by_note_id.remove(id).is_some() {
                self.write_config_unlocked(config)?;
            }
        }
        let _ = self.delete_note_images(id);
        Ok(())
    }

    pub fn images_dir(&self, note_id: &str) -> PathBuf {
        self.data_dir.join("images").join(note_id)
    }

    pub fn save_image(
        &self,
        note_id: &str,
        data: &[u8],
        extension: &str,
    ) -> Result<String, AppError> {
        self.ensure_storage()?;
        self.find_metadata(note_id)?;

        const ALLOWED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"];
        let ext = extension.to_ascii_lowercase();
        if !ALLOWED_EXTENSIONS.contains(&ext.as_str()) {
            return Err(AppError::new(
                "unsupportedImageFormat",
                format!("不支持的图片格式: {ext}"),
            ));
        }

        let dir = self.images_dir(note_id);
        fs::create_dir_all(&dir)?;

        let file_name = format!("{}.{}", Uuid::new_v4(), ext);
        fs::write(dir.join(&file_name), data)?;

        Ok(format!("images/{note_id}/{file_name}"))
    }

    pub fn delete_note_images(&self, note_id: &str) -> Result<(), AppError> {
        let dir = self.images_dir(note_id);
        if dir.exists() {
            fs::remove_dir_all(&dir)?;
        }
        Ok(())
    }

    pub fn clean_unused_images(
        &self,
        note_id: &str,
        content: &str,
    ) -> Result<Vec<String>, AppError> {
        let dir = self.images_dir(note_id);
        if !dir.exists() {
            return Ok(Vec::new());
        }

        let mut removed = Vec::new();
        let mut remaining = 0usize;
        for entry in fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            let relative = format!("images/{note_id}/{file_name}");
            if !content.contains(&relative) {
                fs::remove_file(&path)?;
                removed.push(file_name);
            } else {
                remaining += 1;
            }
        }

        if remaining == 0 {
            let _ = fs::remove_dir(&dir);
        }

        Ok(removed)
    }

    pub fn import_markdown_file(&self, path: &Path, category: &str) -> Result<Note, AppError> {
        if !is_markdown_path(path) {
            return Err(AppError::unsupported_file());
        }

        let content = fs::read_to_string(path)?;
        let title = imported_markdown_title(path, &content);
        self.create_note(SaveNoteRequest {
            title,
            content,
            category: category.to_string(),
        })
    }

    pub fn export_markdown_file(&self, id: &str, path: &Path) -> Result<(), AppError> {
        let note = self.read_note(id)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::write(path, note.content)?;
        Ok(())
    }

    fn default_config(&self) -> AppConfig {
        AppConfig {
            locale: default_locale(),
            data_dir: Some(self.data_dir.to_string_lossy().to_string()),
            #[cfg(target_os = "macos")]
            global_shortcut: DEFAULT_MACOS_GLOBAL_SHORTCUT.into(),
            #[cfg(not(target_os = "macos"))]
            global_shortcut: "Ctrl+Space".into(),
            close_to_tray: true,
            autostart: false,
            default_view_mode: "split".into(),
            note_auto_save: true,
            note_surface_auto_save: true,
            tile_color: default_tile_color(),
            tile_color_mode: default_tile_color_mode(),
            tile_style: default_tile_style(),
            tile_appearance: default_tile_appearance(),
            tile_opacity_by_note_id: BTreeMap::new(),
            theme: default_theme(),
            font_size: default_font_size(),
            surface_font_size: default_surface_font_size(),
            tab_indent_size: default_tab_indent_size(),
            external_file_auto_save: default_external_file_auto_save(),
            background_image_path: String::new(),
            background_fit: default_background_fit(),
            background_dim: default_background_dim(),
            background_blur: default_background_blur(),
            background_scale: default_background_scale(),
            background_position_x: default_background_position(),
            background_position_y: default_background_position(),
            remember_surface_size: default_remember_surface_size(),
            tile_ctrl_close: default_tile_ctrl_close(),
            tile_double_click_to_edit: false,
            tile_save_returns_to_pin: false,
            tile_render_markdown: false,
            render_html_markdown: false,
            split_scroll_sync: true,
            surface_width: None,
            surface_height: None,
            toggle_visibility_shortcut: default_toggle_visibility_shortcut(),
            todo_shortcut: default_todo_shortcut(),
            open_at_cursor: default_open_at_cursor(),
            notes_dir: None,
            last_known_base_dir: None,
        }
    }

    #[cfg(test)]
    fn migrate_config_from_candidates(&self, candidates: &[PathBuf]) -> Result<(), AppError> {
        if self.config_path().exists() {
            return Ok(());
        }
        for old_dir in candidates {
            let old_config = old_dir.join("config.json");
            if !old_config.exists() {
                continue;
            }
            eprintln!(
                "migrating config from {} to {}",
                old_dir.display(),
                self.config_dir.display()
            );
            let old_str = fs::read_to_string(&old_config)?;
            let mut config: AppConfig = serde_json::from_str(&old_str)?;
            let resolved_data_dir = config
                .notes_dir
                .as_deref()
                .map(data_dir_from_notes_dir)
                .unwrap_or_else(|| old_dir.clone());

            // notesDir 不带 notes 后缀（v1.0.0–v1.0.3 的自定义目录），
            // 笔记散落在该目录顶层，先归位到旧版 notes/ 子目录
            let notes_dir_is_loose = config
                .notes_dir
                .as_deref()
                .map(|nd| Path::new(nd) == resolved_data_dir.as_path())
                .unwrap_or(false);
            if notes_dir_is_loose {
                rescue_loose_legacy_notes(old_dir, &resolved_data_dir);
            }

            if resolved_data_dir != *old_dir {
                migrate_legacy_aux_data(old_dir, &resolved_data_dir);
            }

            config.background_image_path =
                remap_path_prefix(&config.background_image_path, old_dir, &resolved_data_dir);
            config.data_dir = Some(resolved_data_dir.to_string_lossy().to_string());
            config.notes_dir = None;
            config.last_known_base_dir = None;
            fs::create_dir_all(&self.config_dir)?;
            write_json_atomic(&self.config_path(), &config)?;
            let marker = old_dir.join(MACOS_SHORTCUT_MIGRATION_MARKER);
            if marker.exists() {
                let _ = fs::copy(
                    &marker,
                    self.config_dir.join(MACOS_SHORTCUT_MIGRATION_MARKER),
                );
            }
            return Ok(());
        }
        Ok(())
    }

    fn ensure_config_dir(&self) -> Result<(), AppError> {
        fs::create_dir_all(&self.config_dir)?;
        Ok(())
    }

    fn ensure_data_dir(&self) -> Result<(), AppError> {
        fs::create_dir_all(&self.data_dir).map_err(|error| {
            AppError::new(
                "dataDirAccess",
                format!("无法创建或访问数据目录: {}", self.data_dir.display()),
            )
            .with_detail("path", self.data_dir.display().to_string())
            .with_detail("reason", error.to_string())
        })?;

        // Program Files is normally read-only for a standard user. The NSIS
        // installer grants Modify only to Document, but report a clear error
        // if that ACL is missing instead of silently falling back elsewhere.
        let probe = self
            .data_dir
            .join(format!(".floral-write-test-{}", Uuid::new_v4()));
        fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&probe)
            .map_err(|error| {
                AppError::new(
                    "dataDirAccess",
                    format!("数据目录不可写: {}", self.data_dir.display()),
                )
                .with_detail("path", self.data_dir.display().to_string())
                .with_detail("reason", error.to_string())
            })?;
        fs::remove_file(probe).map_err(|error| {
            AppError::new(
                "dataDirAccess",
                format!("无法清理数据目录临时文件: {}", self.data_dir.display()),
            )
            .with_detail("path", self.data_dir.display().to_string())
            .with_detail("reason", error.to_string())
        })?;
        Ok(())
    }

    #[cfg(target_os = "macos")]
    fn migrate_macos_shortcut_default(&self, config: &mut AppConfig) -> Result<bool, AppError> {
        let migration_path = self.macos_shortcut_migration_path();
        if migration_path.exists() {
            return Ok(false);
        }

        let should_migrate = LEGACY_MACOS_GLOBAL_SHORTCUTS
            .iter()
            .any(|shortcut| shortcuts_equal(shortcut, &config.global_shortcut));
        if should_migrate {
            config.global_shortcut = DEFAULT_MACOS_GLOBAL_SHORTCUT.into();
        }

        self.mark_macos_shortcut_migration_handled()?;
        Ok(should_migrate)
    }

    #[cfg(not(target_os = "macos"))]
    fn migrate_macos_shortcut_default(&self, _config: &mut AppConfig) -> Result<bool, AppError> {
        Ok(false)
    }

    #[cfg(target_os = "macos")]
    fn mark_macos_shortcut_migration_handled(&self) -> Result<(), AppError> {
        fs::write(self.macos_shortcut_migration_path(), "done")?;
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    fn mark_macos_shortcut_migration_handled(&self) -> Result<(), AppError> {
        Ok(())
    }

    fn ensure_storage(&self) -> Result<(), AppError> {
        self.ensure_data_dir()?;
        self.load_config()?;
        self.ensure_library_dirs()?;
        // An empty index is intentional: unknown Markdown is never auto-imported.
        self.load_metadata()?;
        Ok(())
    }

    fn notes_dir(&self) -> PathBuf {
        self.data_dir.clone()
    }

    fn find_metadata(&self, id: &str) -> Result<NoteMetadata, AppError> {
        self.load_metadata()?
            .notes
            .into_iter()
            .find(|note| note.id == id)
            .ok_or_else(|| AppError::note_not_found(id))
    }

    fn file_name_for(&self, id: &str, title: &str) -> String {
        let safe_title = safe_file_stem(title);
        if safe_title.is_empty() {
            format!("{id}.md")
        } else {
            format!("{id}_{safe_title}.md")
        }
    }

    pub fn migrate_data_to(&self, new_data_dir: &Path) -> Result<NoteStore, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        is_safe_data_dir(new_data_dir)?;
        let canonical_new = canonical_for_compare(new_data_dir);
        let canonical_current = canonical_for_compare(&self.data_dir);
        if canonical_new == canonical_current {
            return Ok(self.clone());
        }
        // 目标位于当前数据目录内部时，notes/images 等会被搬进自己的子目录，
        // 复制阶段自我递归、清理阶段连带删除新目录，必须拒绝
        if canonical_new.starts_with(&canonical_current) {
            return Err(AppError::new(
                "unsafePath",
                "新数据目录不能位于当前数据目录内部，请选择其他位置",
            ));
        }
        if new_data_dir.exists() && fs::read_dir(new_data_dir)?.next().is_some() {
            return Err(AppError::new(
                "dataDirNotEmpty",
                "目标数据目录非空，不能覆盖已有数据",
            ));
        }
        // First copy and verify. The source is never deleted, so a failed
        // migration cannot destroy the only copy of the user's notes.
        copy_private_data_layout(&self.data_dir, new_data_dir)?;

        // 第二阶段：切换配置指向新目录（提交点）
        let new_store = NoteStore::new(self.config_dir.clone(), new_data_dir.to_path_buf());
        let mut config = new_store.load_config()?;
        config.background_image_path =
            remap_path_prefix(&config.background_image_path, &self.data_dir, new_data_dir);
        config.data_dir = Some(new_data_dir.to_string_lossy().to_string());
        new_store.save_config(config)?;

        Ok(new_store)
    }
}

#[cfg(target_os = "macos")]
fn shortcuts_equal(left: &str, right: &str) -> bool {
    fn normalize(value: &str) -> String {
        value
            .chars()
            .filter(|ch| !ch.is_whitespace())
            .flat_map(|ch| ch.to_lowercase())
            .collect()
    }

    normalize(left) == normalize(right)
}

fn safe_file_stem(title: &str) -> String {
    let mut stem = String::new();
    let mut last_was_separator = false;

    for ch in title.trim().chars() {
        let should_separate = ch.is_whitespace()
            || matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*')
            || ch.is_control();

        if should_separate {
            if !stem.is_empty() && !last_was_separator {
                stem.push('_');
                last_was_separator = true;
            }
            continue;
        }

        stem.push(ch);
        last_was_separator = false;
        if stem.chars().count() >= 48 {
            break;
        }
    }

    stem.trim_matches('_').to_string()
}

fn count_words(content: &str) -> usize {
    content.chars().filter(|ch| !ch.is_whitespace()).count()
}

fn preview(content: &str) -> String {
    content
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(80)
        .collect()
}

fn id_from_file_name(file_name: &str) -> Option<String> {
    let stem = file_name.strip_suffix(".md")?;
    Some(
        stem.split_once('_')
            .map(|(id, _)| id.to_string())
            .unwrap_or_else(|| stem.to_string()),
    )
}

fn is_markdown_path(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.eq_ignore_ascii_case("md"))
        .unwrap_or(false)
}

fn imported_markdown_title(path: &Path, content: &str) -> String {
    let first_line = content.lines().next().unwrap_or_default();
    let first_line = first_line.trim_start_matches('\u{feff}').trim_start();

    if let Some(title) = first_line
        .strip_prefix("# ")
        .map(str::trim)
        .filter(|title| !title.is_empty())
    {
        return title.to_string();
    }

    path.file_stem()
        .and_then(|file_stem| file_stem.to_str())
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or("导入笔记")
        .to_string()
}

fn default_note_auto_save() -> bool {
    true
}

fn default_note_surface_auto_save() -> bool {
    true
}

fn default_tile_color() -> String {
    "#f6f3ec".into()
}

fn default_tile_color_mode() -> String {
    "system".into()
}

fn default_todo_shortcut() -> String {
    "Ctrl+Alt+T".into()
}

fn default_tile_style() -> String {
    "floral-purple".into()
}
fn default_tile_appearance() -> String {
    "system".into()
}

pub(super) fn normalize_tile_opacity(value: f64) -> f64 {
    if value.is_finite() {
        (value.clamp(0.05, 0.95) * 20.0).round() / 20.0
    } else {
        0.45
    }
}

fn deserialize_tile_opacities<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<String, f64>, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value
        .as_object()
        .map(|map| {
            map.iter()
                .map(|(id, value)| {
                    (
                        id.clone(),
                        normalize_tile_opacity(value.as_f64().unwrap_or(0.45)),
                    )
                })
                .collect()
        })
        .unwrap_or_default())
}

fn normalize_tile_config(config: &mut AppConfig) {
    if ![
        "paper",
        "minimal",
        "glass-blue",
        "floral-purple",
        "floral-green",
    ]
    .contains(&config.tile_style.as_str())
    {
        config.tile_style = default_tile_style();
    }
    if !["system", "light", "dark"].contains(&config.tile_appearance.as_str()) {
        config.tile_appearance = default_tile_appearance();
    }
    for value in config.tile_opacity_by_note_id.values_mut() {
        *value = normalize_tile_opacity(*value);
    }
}

fn default_theme() -> String {
    "system".into()
}

fn default_font_size() -> u32 {
    14
}

fn default_surface_font_size() -> u32 {
    14
}

fn default_tab_indent_size() -> u32 {
    2
}

fn default_external_file_auto_save() -> bool {
    true
}

fn default_background_fit() -> String {
    "cover".into()
}

fn default_background_dim() -> f64 {
    0.25
}

fn default_background_blur() -> f64 {
    0.0
}

fn default_background_scale() -> f64 {
    1.0
}

fn default_background_position() -> f64 {
    50.0
}

fn default_remember_surface_size() -> bool {
    true
}

fn default_tile_ctrl_close() -> bool {
    true
}

fn default_split_scroll_sync() -> bool {
    true
}

fn default_toggle_visibility_shortcut() -> String {
    String::new()
}

fn default_open_at_cursor() -> bool {
    true
}

fn default_locale() -> String {
    "zh-CN".into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn test_root(name: &str) -> PathBuf {
        let base = std::env::var_os("FLORAL_NOTEPAPER_REGULUSAPPLEX_TEST_TEMP_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|| std::env::temp_dir().join("floral-notepaper-rust-tests"));
        let root = base.join(name);
        if root.exists() {
            fs::remove_dir_all(&root).expect("remove stale test root");
        }
        fs::create_dir_all(&root).expect("create test root");
        root
    }

    fn test_store(name: &str) -> NoteStore {
        let root = test_root(name);
        let store = NoteStore::new(root.clone(), root);
        // Seed an isolated config before exercising storage.
        write_json_atomic(&store.config_path(), &store.default_config())
            .expect("seed isolated test config");
        store
    }

    #[test]
    fn creates_updates_reads_and_deletes_markdown_notes() {
        let store = test_store("crud");

        let created = store
            .create_note(SaveNoteRequest {
                title: "A/B:Test".into(),
                content: "hello\nworld".into(),
                category: String::new(),
            })
            .expect("create note");

        assert_eq!(created.title, "A/B:Test");
        assert_eq!(created.content, "hello\nworld");
        assert_eq!(created.word_count, 10);
        assert!(created.file_name.ends_with(".md"));
        assert!(created.file_name.contains("A_B_Test"));

        let loaded = store.read_note(&created.id).expect("read note");
        assert_eq!(loaded, created);

        let listed = store.list_notes().expect("list notes");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);
        assert_eq!(listed[0].preview, "hello world");

        let updated = store
            .update_note(
                &created.id,
                SaveNoteRequest {
                    title: "".into(),
                    content: "# 新标题\nsecond line".into(),
                    category: String::new(),
                },
            )
            .expect("update note");

        assert_eq!(updated.title, "");
        assert_eq!(updated.content, "# 新标题\nsecond line");
        assert_ne!(updated.file_name, created.file_name);

        store.delete_note(&created.id).expect("delete note");
        assert!(store.read_note(&created.id).is_err());
        assert!(store.list_notes().expect("list after delete").is_empty());
    }

    #[test]
    fn private_templates_remain_ordinary_notes_after_reopen() {
        assert!(known_data_migration_candidates().is_empty());
        let store = test_store("private-template-roundtrip");
        store.create_category("工作").unwrap();
        let content = "# 2026-W38 周小结\n\n## 本周完成\n\n手动记录\n";
        let request = SaveNoteRequest {
            title: "2026-W38 周小结".into(),
            content: content.into(),
            category: "工作".into(),
        };
        let first = store.create_note(request.clone()).unwrap();
        let second = store.create_note(request).unwrap();
        assert_ne!(first.id, second.id);
        assert_ne!(first.file_name, second.file_name);
        let reopened = NoteStore::new(store.config_dir.clone(), store.data_dir.clone());
        assert_eq!(reopened.read_note(&first.id).unwrap().content, content);
        assert_eq!(reopened.read_note(&first.id).unwrap().category, "工作");
        let edited = reopened
            .update_note(
                &first.id,
                SaveNoteRequest {
                    title: "手动重命名".into(),
                    content: format!("{content}\n继续编辑"),
                    category: "工作".into(),
                },
            )
            .unwrap();
        assert!(reopened
            .read_note(&first.id)
            .unwrap()
            .content
            .ends_with("继续编辑"));
        reopened.move_note_to_category(&edited.id, "").unwrap();
        assert!(reopened.read_note(&edited.id).unwrap().category.is_empty());
        reopened.delete_note(&edited.id).unwrap();
        assert_eq!(reopened.list_notes().unwrap().len(), 1);
        assert!(store.metadata_path().is_file());
        assert!(!store.data_dir.join("reports").exists());
    }

    #[test]
    fn data_migration_rejects_existing_destination_without_changes() {
        let store = test_store("private-migration-nonempty");
        let root = test_root("private-migration-sibling");
        let target = root.join("existing");
        fs::create_dir_all(&target).unwrap();
        fs::write(target.join("metadata.json"), "DO NOT CHANGE").unwrap();
        let error = store.migrate_data_to(&target).unwrap_err();
        assert_eq!(error.code, "dataDirNotEmpty");
        assert_eq!(
            fs::read_to_string(target.join("metadata.json")).unwrap(),
            "DO NOT CHANGE"
        );
        assert_eq!(
            store.load_config().unwrap().data_dir.as_deref(),
            Some(store.data_dir.to_str().unwrap())
        );
    }

    #[test]
    fn rebuilds_metadata_when_metadata_json_is_corrupt() {
        let store = test_store("repair");
        let first = store
            .create_note(SaveNoteRequest {
                title: "第一条".into(),
                content: "# 第一条\n正文".into(),
                category: String::new(),
            })
            .expect("create first");
        let second = store
            .create_note(SaveNoteRequest {
                title: "第二条".into(),
                content: "第二条正文".into(),
                category: String::new(),
            })
            .expect("create second");

        fs::write(store.metadata_path(), "{ broken json").expect("corrupt metadata");

        let repaired = store.list_notes().expect("repair metadata");
        let ids: Vec<_> = repaired.iter().map(|note| note.id.as_str()).collect();

        assert_eq!(repaired.len(), 2);
        assert!(ids.contains(&first.id.as_str()));
        assert!(ids.contains(&second.id.as_str()));

        // 损坏文件被备份保留，供事后取证分析
        let corrupt_backup = fs::read_dir(store.data_dir())
            .expect("read data dir")
            .filter_map(|entry| entry.ok())
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("metadata.corrupt-")
            });
        assert!(corrupt_backup, "corrupt metadata should be backed up");
    }

    #[test]
    fn reads_and_writes_config_json() {
        let store = test_store("config");
        fs::create_dir_all(store.config_dir.as_path()).expect("create config dir");
        write_json_atomic(&store.config_path(), &store.default_config())
            .expect("write default config");

        let default_config = store.load_config().expect("load default config");
        #[cfg(target_os = "macos")]
        assert_eq!(default_config.global_shortcut, "Command+Option+N");
        #[cfg(not(target_os = "macos"))]
        assert_eq!(default_config.global_shortcut, "Ctrl+Space");
        assert!(default_config.note_auto_save);
        assert!(default_config.note_surface_auto_save);
        assert_eq!(default_config.tile_color, "#f6f3ec");
        assert_eq!(default_config.tile_color_mode, "system");
        assert!(!default_config.tile_double_click_to_edit);
        assert!(!default_config.tile_save_returns_to_pin);
        assert_eq!(default_config.theme, "system");
        assert_eq!(default_config.locale, "zh-CN");
        assert_eq!(
            default_config.data_dir.as_deref(),
            Some(store.data_dir().to_string_lossy().as_ref())
        );

        let mut saved = AppConfig {
            locale: "en-US".into(),
            data_dir: None,
            global_shortcut: "Alt+Space".into(),
            close_to_tray: false,
            autostart: true,
            default_view_mode: "preview".into(),
            note_auto_save: false,
            note_surface_auto_save: false,
            tile_color: "#efe8dc".into(),
            tile_color_mode: "custom".into(),
            tile_style: "floral-purple".into(),
            tile_appearance: "system".into(),
            tile_opacity_by_note_id: Default::default(),
            todo_shortcut: default_todo_shortcut(),
            theme: "dark".into(),
            font_size: 16,
            surface_font_size: 16,
            tab_indent_size: 2,
            external_file_auto_save: true,
            background_image_path: String::new(),
            background_fit: "cover".into(),
            background_dim: 0.25,
            background_blur: 0.0,
            background_scale: 1.0,
            background_position_x: 50.0,
            background_position_y: 50.0,
            remember_surface_size: true,
            tile_ctrl_close: true,
            tile_double_click_to_edit: true,
            tile_save_returns_to_pin: true,
            tile_render_markdown: false,
            render_html_markdown: false,
            split_scroll_sync: true,
            surface_width: None,
            surface_height: None,
            toggle_visibility_shortcut: String::new(),
            notes_dir: None,
            last_known_base_dir: None,
            open_at_cursor: true,
        };

        store.save_config(saved.clone()).expect("save config");

        let loaded = store.load_config().expect("reload config");
        saved.data_dir = Some(store.data_dir().to_string_lossy().to_string());
        assert_eq!(loaded, saved);
    }

    #[test]
    fn data_migration_candidates_include_legacy_chinese_dirs() {
        let candidates = known_data_migration_candidates_for(
            Some("/Users/alice".into()),
            Some(r"C:\Users\Alice".into()),
        );

        assert!(candidates.contains(
            &PathBuf::from("/Users/alice")
                .join("Documents")
                .join("花笺-RegulusApplEx")
        ));
        assert!(candidates.contains(
            &PathBuf::from("/Users/alice")
                .join("Library")
                .join("Application Support")
                .join("花笺-RegulusApplEx")
        ));
        assert!(candidates.contains(
            &PathBuf::from(r"C:\Users\Alice")
                .join("Documents")
                .join("花笺-RegulusApplEx")
        ));
    }

    #[test]
    fn legacy_and_invalid_tile_config_values_have_safe_defaults() {
        let store = test_store("tile-config-compatibility");
        let mut json = serde_json::to_value(store.default_config()).unwrap();
        let map = json.as_object_mut().unwrap();
        map.remove("tileStyle");
        map.remove("tileAppearance");
        map.remove("tileOpacityByNoteId");
        write_json_atomic(&store.config_path(), &json).unwrap();
        let legacy = store.load_config().unwrap();
        assert_eq!(legacy.tile_style, "floral-purple");
        assert_eq!(legacy.tile_appearance, "system");
        assert!(legacy.tile_opacity_by_note_id.is_empty());

        json["tileStyle"] = serde_json::json!("unknown-style");
        json["tileAppearance"] = serde_json::json!("unknown-mode");
        json["tileOpacityByNoteId"] =
            serde_json::json!({"low": -1, "high": 9, "bad": "oops", "null": null, "ok": 0.75});
        write_json_atomic(&store.config_path(), &json).unwrap();
        let config = store.load_config().unwrap();
        assert_eq!(config.tile_style, "floral-purple");
        assert_eq!(config.tile_appearance, "system");
        assert_eq!(config.tile_opacity_by_note_id["low"], 0.05);
        assert_eq!(config.tile_opacity_by_note_id["high"], 0.95);
        assert_eq!(config.tile_opacity_by_note_id["bad"], 0.45);
        assert_eq!(config.tile_opacity_by_note_id["null"], 0.45);
        assert_eq!(config.tile_opacity_by_note_id["ok"], 0.75);
    }

    #[test]
    fn new_todo_shortcut_preserves_legacy_keys_and_explicit_disable() {
        let store = test_store("todo-shortcut-compatibility");
        let mut json = serde_json::to_value(store.default_config()).unwrap();
        json.as_object_mut().unwrap().remove("todoShortcut");
        json["globalShortcut"] = serde_json::json!("Ctrl+Alt+T");
        write_json_atomic(&store.config_path(), &json).unwrap();
        let config = store.load_config().unwrap();
        assert_eq!(config.global_shortcut, "Ctrl+Alt+T");
        assert_eq!(config.todo_shortcut, "");
        json["globalShortcut"] = serde_json::json!("Ctrl+Alt+N");
        write_json_atomic(&store.config_path(), &json).unwrap();
        assert_eq!(store.load_config().unwrap().todo_shortcut, "Ctrl+Alt+T");
        json["todoShortcut"] = serde_json::json!("");
        write_json_atomic(&store.config_path(), &json).unwrap();
        assert_eq!(store.load_config().unwrap().todo_shortcut, "");
    }

    #[test]
    fn tile_opacity_updates_are_independent_and_survive_stale_settings_saves() {
        let store = test_store("tile-opacity-concurrency");
        let create = |title: &str| {
            store
                .create_note(SaveNoteRequest {
                    title: title.into(),
                    content: "- [ ] task\r\n".into(),
                    category: "tiles".into(),
                })
                .unwrap()
        };
        let first = create("First");
        let second = create("Second");
        let mut stale = store.load_config().unwrap();
        stale.tile_style = "floral-green".into();
        std::thread::scope(|scope| {
            scope.spawn(|| store.set_tile_opacity(&first.id, 0.6).unwrap());
            scope.spawn(|| store.set_tile_opacity(&second.id, 0.8).unwrap());
        });
        let saved = store.save_config(stale).unwrap();
        assert_eq!(saved.tile_opacity_by_note_id[&first.id], 0.6);
        assert_eq!(saved.tile_opacity_by_note_id[&second.id], 0.8);
        let reopened = NoteStore::new(store.config_dir.clone(), store.data_dir.clone());
        assert_eq!(
            reopened.load_config().unwrap().tile_opacity_by_note_id,
            saved.tile_opacity_by_note_id
        );
        assert_eq!(
            reopened.read_note(&first.id).unwrap().content,
            "- [ ] task\r\n"
        );
        store.delete_note(&first.id).unwrap();
        let after = store.load_config().unwrap();
        assert!(!after.tile_opacity_by_note_id.contains_key(&first.id));
        assert_eq!(after.tile_opacity_by_note_id[&second.id], 0.8);
        assert!(store.set_tile_opacity(&first.id, 0.7).is_err());
    }

    #[test]
    fn loads_legacy_config_with_note_surface_auto_save_enabled() {
        let store = test_store("legacy-config");
        let notes_dir = store.data_dir().join("notes");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        fs::write(
            store.config_path(),
            format!(
                r#"{{
  "notesDir": "{}",
  "globalShortcut": "Ctrl+Space",
  "closeToTray": true,
  "autostart": false,
  "defaultViewMode": "split"
}}"#,
                notes_dir.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .expect("write legacy config");

        let loaded = store.load_config().expect("load legacy config");

        assert!(loaded.note_auto_save);
        assert!(loaded.note_surface_auto_save);
        assert_eq!(loaded.tile_color, "#f6f3ec");
        assert_eq!(loaded.tile_color_mode, "system");
        assert!(!loaded.tile_double_click_to_edit);
        assert!(!loaded.tile_save_returns_to_pin);
        assert_eq!(loaded.theme, "system");
        assert_eq!(loaded.locale, "zh-CN");
        assert_eq!(loaded.font_size, 14);
        assert_eq!(loaded.surface_font_size, 14);
    }

    fn legacy_config_json(notes_dir: &Path, background_image_path: &str) -> String {
        format!(
            r#"{{
  "notesDir": "{}",
  "globalShortcut": "Ctrl+Space",
  "closeToTray": true,
  "autostart": false,
  "defaultViewMode": "split",
  "backgroundImagePath": "{}"
}}"#,
            notes_dir.to_string_lossy().replace('\\', "\\\\"),
            background_image_path.replace('\\', "\\\\")
        )
    }

    #[test]
    fn migrates_legacy_aux_data_when_notes_dir_was_customized() {
        let root = test_root("legacy-aux-migration");
        let old_dir = root.join("old-base");
        let custom_dir = root.join("custom");
        let custom_notes = custom_dir.join("notes");
        fs::create_dir_all(&custom_notes).expect("create custom notes dir");
        fs::write(custom_notes.join("id-1_笔记.md"), "# 标题\n内容").expect("write note");

        fs::create_dir_all(old_dir.join("images").join("id-1")).expect("create images dir");
        fs::write(old_dir.join("images").join("id-1").join("p.png"), b"png").expect("write image");
        fs::create_dir_all(old_dir.join("backgrounds")).expect("create backgrounds dir");
        fs::write(old_dir.join("backgrounds").join("bg-1.png"), b"bg").expect("write background");
        fs::write(old_dir.join("metadata.json"), r#"{"notes":[]}"#).expect("write metadata");
        let old_background = old_dir.join("backgrounds").join("bg-1.png");
        fs::write(
            old_dir.join("config.json"),
            legacy_config_json(&custom_notes, &old_background.to_string_lossy()),
        )
        .expect("write legacy config");

        let store = NoteStore::new(root.join("appdata"), custom_dir.clone());
        store
            .migrate_config_from_candidates(std::slice::from_ref(&old_dir))
            .expect("migrate legacy config");

        assert!(custom_dir.join("metadata.json").exists());
        assert!(custom_dir
            .join("images")
            .join("id-1")
            .join("p.png")
            .exists());
        assert!(custom_dir.join("backgrounds").join("bg-1.png").exists());
        assert!(!old_dir.join("metadata.json").exists());
        assert!(!old_dir.join("images").exists());
        assert!(!old_dir.join("backgrounds").exists());

        let migrated: AppConfig =
            serde_json::from_str(&fs::read_to_string(store.config_path()).expect("read config"))
                .expect("parse migrated config");
        assert_eq!(
            migrated.data_dir.as_deref(),
            Some(custom_dir.to_string_lossy().as_ref())
        );
        assert_eq!(
            migrated.background_image_path,
            custom_dir
                .join("backgrounds")
                .join("bg-1.png")
                .to_string_lossy()
        );
    }

    #[test]
    fn rescues_loose_notes_from_pre_suffix_custom_dir() {
        let root = test_root("legacy-loose-notes");
        let old_dir = root.join("old-base");
        // v1.0.0–v1.0.3 自定义目录不带 notes 后缀，笔记直接位于目录顶层
        let custom_dir = root.join("custom");
        fs::create_dir_all(custom_dir.join("工作")).expect("create category dir");
        fs::write(custom_dir.join("id-1_第一篇.md"), "# 第一篇").expect("write loose note");
        fs::write(custom_dir.join("工作").join("id-2_第二篇.md"), "# 第二篇")
            .expect("write category note");
        fs::write(custom_dir.join("无关文件.md"), "未被跟踪").expect("write untracked file");

        fs::create_dir_all(&old_dir).expect("create old base");
        fs::write(
            old_dir.join("metadata.json"),
            r#"{"notes":[
  {"id":"id-1","title":"第一篇","fileName":"id-1_第一篇.md","category":"","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-02T00:00:00Z","wordCount":3,"preview":"第一篇"},
  {"id":"id-2","title":"第二篇","fileName":"id-2_第二篇.md","category":"工作","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z","wordCount":3,"preview":"第二篇"}
]}"#,
        )
        .expect("write legacy metadata");
        fs::write(
            old_dir.join("config.json"),
            legacy_config_json(&custom_dir, ""),
        )
        .expect("write legacy config");

        let store = NoteStore::new(root.join("appdata"), custom_dir.clone());
        store
            .migrate_config_from_candidates(std::slice::from_ref(&old_dir))
            .expect("migrate legacy config");

        assert!(custom_dir.join("notes").join("id-1_第一篇.md").exists());
        assert!(custom_dir
            .join("notes")
            .join("工作")
            .join("id-2_第二篇.md")
            .exists());
        assert!(!custom_dir.join("id-1_第一篇.md").exists());
        // metadata 未跟踪的文件留在原处
        assert!(custom_dir.join("无关文件.md").exists());
        // metadata.json 一并迁入新数据目录，created_at 不丢失
        assert!(custom_dir.join("metadata.json").exists());

        let notes = store.list_notes().expect("list notes after migration");
        assert_eq!(notes.len(), 2);
        let first = notes
            .iter()
            .find(|note| note.id == "id-1")
            .expect("find first note");
        assert_eq!(first.created_at.to_rfc3339(), "2026-01-01T00:00:00+00:00");
    }

    #[test]
    fn rescues_loose_notes_by_scanning_when_metadata_missing() {
        let root = test_root("legacy-loose-notes-scan");
        let old_dir = root.join("old-base");
        let custom_dir = root.join("custom");
        fs::create_dir_all(custom_dir.join("分类")).expect("create category dir");
        fs::write(custom_dir.join("id-1_散落.md"), "# 散落").expect("write loose note");
        fs::write(custom_dir.join("分类").join("id-2_归类.md"), "# 归类")
            .expect("write category note");

        fs::create_dir_all(&old_dir).expect("create old base");
        fs::write(
            old_dir.join("config.json"),
            legacy_config_json(&custom_dir, ""),
        )
        .expect("write legacy config");

        let store = NoteStore::new(root.join("appdata"), custom_dir.clone());
        store
            .migrate_config_from_candidates(std::slice::from_ref(&old_dir))
            .expect("migrate legacy config");

        assert!(custom_dir.join("notes").join("id-1_散落.md").exists());
        assert!(custom_dir
            .join("notes")
            .join("分类")
            .join("id-2_归类.md")
            .exists());
    }

    // Reinstalling into an empty Document must not import a remembered dataDir.
    #[test]
    fn ignores_previous_data_dir_even_when_target_is_empty() {
        let root = test_root("relocate-empty");
        let config_dir = root.join("config");
        let old_data = root.join("old");
        let new_data = root.join("new");

        // 在旧位置创建一条笔记，并把 config 持久化为指向旧位置
        let old_store = NoteStore::new(config_dir.clone(), old_data.clone());
        let created = old_store
            .create_note(SaveNoteRequest {
                title: "重定位".into(),
                content: "# 重定位\n正文".into(),
                category: String::new(),
            })
            .expect("create note in old dir");
        old_store.load_config().expect("persist old config");
        let old_metadata = fs::read(old_store.metadata_path()).unwrap();

        // 新 store 共享同一 config 目录，但 data_dir 指向新空目录
        let new_store = NoteStore::new(config_dir.clone(), new_data.clone());
        let notes = new_store.list_notes().expect("list after relocate");

        assert!(notes.is_empty());
        assert!(new_data.join("metadata.json").exists());
        assert_eq!(fs::read(old_store.metadata_path()).unwrap(), old_metadata);
        assert_eq!(
            fs::read_to_string(old_data.join(&created.file_name)).unwrap(),
            created.content
        );
        assert!(!new_data.join(&created.file_name).exists());

        let config: AppConfig = serde_json::from_str(
            &fs::read_to_string(new_store.config_path()).expect("read config"),
        )
        .expect("parse config");
        assert_eq!(
            config.data_dir.as_deref(),
            Some(new_data.to_string_lossy().as_ref())
        );
    }

    // 新位置已有用户数据时绝不合并，保留两边，防止交叉污染
    #[test]
    fn does_not_merge_relocated_data_into_non_empty_target() {
        let root = test_root("relocate-non-empty");
        let config_dir = root.join("config");
        let old_data = root.join("old");
        let new_data = root.join("new");

        let old_store = NoteStore::new(config_dir.clone(), old_data.clone());
        old_store
            .create_note(SaveNoteRequest {
                title: "旧数据".into(),
                content: "旧正文".into(),
                category: String::new(),
            })
            .expect("create old note");
        old_store.load_config().expect("persist old config");

        // 新位置已有独立笔记
        let seed_store = NoteStore::new(root.join("seed-config"), new_data.clone());
        let kept = seed_store
            .create_note(SaveNoteRequest {
                title: "新数据".into(),
                content: "新正文".into(),
                category: String::new(),
            })
            .expect("create new note");

        let new_store = NoteStore::new(config_dir.clone(), new_data.clone());
        let notes = new_store.list_notes().expect("list after relocate");

        // 只保留新位置原有数据，旧数据未被搬入合并
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, kept.id);
        // 旧数据原地保留，未丢失
        assert!(old_data.join("metadata.json").exists());
    }

    #[test]
    fn does_not_import_or_flatten_a_previous_notes_directory() {
        let root = test_root("flatten-legacy-notes");
        let config_dir = root.join("config");
        let old_data = root.join("old");
        let new_data = root.join("new");

        let old_store = NoteStore::new(config_dir.clone(), old_data.clone());
        let created = old_store
            .create_period_note(PeriodNoteRequest {
                record_type: RecordType::Diary,
                record_period: "2026-09-20".into(),
                title: "2026-09-20 日记".into(),
                content: "# 日记\n正文".into(),
            })
            .expect("create legacy diary");
        old_store.load_config().expect("persist legacy config");

        fs::create_dir_all(old_data.join("notes")).expect("create legacy notes wrapper");
        fs::rename(old_data.join("diary"), old_data.join("notes").join("diary"))
            .expect("move legacy diary under notes");

        let new_store = NoteStore::new(config_dir, new_data.clone());
        let notes = new_store.list_notes().expect("migrate legacy layout");

        assert!(notes.is_empty());
        assert!(!new_data
            .join("diary")
            .join("2026")
            .join("2026-W38")
            .is_dir());
        assert!(!new_data.join("notes").exists());
        assert_eq!(
            fs::read_to_string(
                old_data
                    .join("notes")
                    .join(&created.category)
                    .join(&created.file_name)
            )
            .unwrap(),
            created.content
        );
    }

    #[test]
    fn ignores_legacy_notes_dir_in_settings() {
        let store = test_store("ignore-legacy-settings-location");
        let historical = store.data_dir.join("historical");
        fs::create_dir_all(historical.join("notes")).unwrap();
        fs::write(historical.join("notes").join("untouched.md"), "untouched").unwrap();
        fs::write(historical.join("metadata.json"), "not a valid index").unwrap();
        fs::write(
            store.config_path(),
            legacy_config_json(&historical.join("notes"), ""),
        )
        .unwrap();
        assert!(store.list_notes().unwrap().is_empty());
        assert!(!store.data_dir.join("untouched.md").exists());
        assert_eq!(
            fs::read_to_string(historical.join("metadata.json")).unwrap(),
            "not a valid index"
        );
    }

    #[test]
    fn migrate_data_to_moves_items_and_updates_config() {
        let root = test_root("migrate-data-dir");
        let config_dir = root.join("config");
        let data_dir = root.join("data");
        let store = NoteStore::new(config_dir.clone(), data_dir.clone());
        fs::create_dir_all(&config_dir).expect("create config dir");
        write_json_atomic(&store.config_path(), &store.default_config())
            .expect("write default config");
        let note = store
            .create_note(SaveNoteRequest {
                title: "迁移测试".into(),
                content: "# 迁移测试\n正文".into(),
                category: String::new(),
            })
            .expect("create note");

        let target = root.join("target");
        let new_store = store.migrate_data_to(&target).expect("migrate data dir");

        assert_eq!(new_store.data_dir(), target.as_path());
        assert!(target.join("metadata.json").exists());
        assert!(!target.join("notes").exists());
        assert!(data_dir.join("metadata.json").exists());

        let notes = new_store.list_notes().expect("list notes after migration");
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].id, note.id);

        let config: AppConfig =
            serde_json::from_str(&fs::read_to_string(store.config_path()).expect("read config"))
                .expect("parse config");
        assert_eq!(
            config.data_dir.as_deref(),
            Some(target.to_string_lossy().as_ref())
        );
    }

    #[test]
    fn migrate_data_to_rejects_target_inside_current_data_dir() {
        let root = test_root("migrate-nested-reject");
        let config_dir = root.join("config");
        let data_dir = root.join("data");
        let store = NoteStore::new(config_dir.clone(), data_dir.clone());
        fs::create_dir_all(&config_dir).expect("create config dir");
        write_json_atomic(&store.config_path(), &store.default_config())
            .expect("write default config");
        store
            .create_note(SaveNoteRequest {
                title: "防护测试".into(),
                content: "正文".into(),
                category: String::new(),
            })
            .expect("create note");

        let error = store
            .migrate_data_to(&data_dir.join("notes").join("floral"))
            .expect_err("target inside data dir must be rejected");
        assert_eq!(error.code, "unsafePath");

        // 数据未被破坏，配置仍指向原目录
        assert!(!data_dir.join("notes").exists());
        assert!(data_dir.join("metadata.json").exists());
        let config: AppConfig =
            serde_json::from_str(&fs::read_to_string(store.config_path()).expect("read config"))
                .expect("parse config");
        assert_eq!(
            config.data_dir.as_deref(),
            Some(data_dir.to_string_lossy().as_ref())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn migrates_legacy_macos_shortcut_default_once() {
        let store = test_store("legacy-macos-shortcut");
        let notes_dir = store.data_dir().join("notes");
        fs::create_dir_all(store.data_dir()).expect("create base dir");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        fs::write(
            store.config_path(),
            format!(
                r#"{{
  "notesDir": "{}",
  "globalShortcut": "Option+Space",
  "closeToTray": true,
  "autostart": false,
  "defaultViewMode": "split"
}}"#,
                notes_dir.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .expect("write legacy config");

        let migrated = store.load_config().expect("load legacy config");

        assert_eq!(migrated.global_shortcut, "Command+Option+N");
        assert!(store.macos_shortcut_migration_path().exists());

        let mut manual = migrated;
        manual.global_shortcut = "Option+Space".into();
        store
            .save_config(manual.clone())
            .expect("save manual config");

        let loaded = store.load_config().expect("reload manual config");
        assert_eq!(loaded.global_shortcut, "Option+Space");
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn migrates_previous_macos_shortcut_default() {
        let store = test_store("previous-macos-shortcut");
        let notes_dir = store.data_dir().join("notes");
        fs::create_dir_all(store.data_dir()).expect("create base dir");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        fs::write(
            store.config_path(),
            format!(
                r#"{{
  "notesDir": "{}",
  "globalShortcut": "Ctrl+Option+Space",
  "closeToTray": true,
  "autostart": false,
  "defaultViewMode": "split"
}}"#,
                notes_dir.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .expect("write previous config");

        let migrated = store.load_config().expect("load previous config");

        assert_eq!(migrated.global_shortcut, "Command+Option+N");
        assert!(store.macos_shortcut_migration_path().exists());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn leaves_custom_macos_shortcut_unchanged() {
        let store = test_store("custom-macos-shortcut");
        let notes_dir = store.data_dir().join("notes");
        fs::create_dir_all(store.data_dir()).expect("create base dir");
        fs::create_dir_all(&notes_dir).expect("create notes dir");
        fs::write(
            store.config_path(),
            format!(
                r#"{{
  "notesDir": "{}",
  "globalShortcut": "Command+K",
  "closeToTray": true,
  "autostart": false,
  "defaultViewMode": "split"
}}"#,
                notes_dir.to_string_lossy().replace('\\', "\\\\")
            ),
        )
        .expect("write custom config");

        let loaded = store.load_config().expect("load custom config");

        assert_eq!(loaded.global_shortcut, "Command+K");
        assert!(store.macos_shortcut_migration_path().exists());
    }

    #[test]
    fn imports_markdown_heading_title_without_stripping_content() {
        let root = test_root("import-heading-title");
        let source_path = root.join("外部文件.md");
        let source_content = "# 导入标题\n正文第一行\n正文第二行";
        fs::write(&source_path, source_content).expect("write source markdown");
        let store_path = root.join("store");
        let store = NoteStore::new(store_path.clone(), store_path);

        let imported = store
            .import_markdown_file(&source_path, "")
            .expect("import markdown");

        assert_eq!(imported.title, "导入标题");
        assert_eq!(imported.content, source_content);
        assert_eq!(
            store
                .read_note(&imported.id)
                .expect("read imported")
                .content,
            source_content
        );
    }

    #[test]
    fn imports_markdown_title_from_file_name_without_heading() {
        let root = test_root("import-file-title");
        let source_path = root.join("会议记录.md");
        let source_content = "正文第一行\n# 不是第一行标题";
        fs::write(&source_path, source_content).expect("write source markdown");
        let store_path = root.join("store");
        let store = NoteStore::new(store_path.clone(), store_path);

        let imported = store
            .import_markdown_file(&source_path, "")
            .expect("import markdown");

        assert_eq!(imported.title, "会议记录");
        assert_eq!(imported.content, source_content);
    }

    #[test]
    fn exports_markdown_file_without_rewriting_content() {
        let root = test_root("export-markdown");
        let store_path = root.join("store");
        let store = NoteStore::new(store_path.clone(), store_path);
        let content = "# 原始标题\n正文\n- 列表";
        let note = store
            .create_note(SaveNoteRequest {
                title: "导出标题".into(),
                content: content.into(),
                category: String::new(),
            })
            .expect("create note");
        let export_path = root.join("exports").join("导出.md");

        store
            .export_markdown_file(&note.id, &export_path)
            .expect("export markdown");

        assert_eq!(
            fs::read_to_string(export_path).expect("read exported markdown"),
            content
        );
    }
}
