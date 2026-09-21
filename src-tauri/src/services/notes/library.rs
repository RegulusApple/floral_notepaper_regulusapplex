use super::*;
#[cfg(test)]
#[path = "library_tests.rs"]
mod library_tests;
use chrono::{Datelike, NaiveDate, Weekday};
use std::{io::Write, sync::Mutex};

// All windows share the same Tauri process. Hold this across uniqueness checks,
// file operations and index publication, not just across the JSON write.
pub(super) static STORAGE_LOCK: Mutex<()> = Mutex::new(());
const SYSTEM_ROOTS: [&str; 4] = ["diary", "weekly", "monthly", "tiles"];

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RecordType {
    #[default]
    Ordinary,
    Diary,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodNoteRequest {
    pub record_type: RecordType,
    pub record_period: String,
    pub title: String,
    pub content: String,
}

fn library_error(code: &str) -> AppError {
    AppError::new(code, code)
}

fn period_folder(kind: RecordType, period: &str) -> Result<String, AppError> {
    let invalid = || library_error("recordPeriodInvalid");
    let date = match kind {
        RecordType::Diary => {
            let date = NaiveDate::parse_from_str(period, "%Y-%m-%d").map_err(|_| invalid())?;
            if date.format("%Y-%m-%d").to_string() != period {
                return Err(invalid());
            }
            date
        }
        RecordType::Weekly => {
            let (year, week) = period.split_once("-W").ok_or_else(invalid)?;
            let date = NaiveDate::from_isoywd_opt(
                year.parse().map_err(|_| invalid())?,
                week.parse().map_err(|_| invalid())?,
                Weekday::Thu,
            )
            .ok_or_else(invalid)?;
            if date.format("%G-W%V").to_string() != period {
                return Err(invalid());
            }
            date
        }
        RecordType::Monthly => {
            let date = NaiveDate::parse_from_str(&format!("{period}-01"), "%Y-%m-%d")
                .map_err(|_| invalid())?;
            if date.format("%Y-%m").to_string() != period {
                return Err(invalid());
            }
            date
        }
        RecordType::Ordinary => return Err(invalid()),
    };
    if !(1000..=9999).contains(&date.year()) {
        return Err(invalid());
    }
    Ok(match kind {
        RecordType::Diary => format!("diary/{}/{}", date.format("%G"), date.format("%G-W%V")),
        RecordType::Weekly => format!("weekly/{}/{}", date.format("%Y"), date.format("%m")),
        RecordType::Monthly => format!("monthly/{}", date.format("%Y")),
        RecordType::Ordinary => unreachable!(),
    })
}

fn validate_relative(value: &str, allow_empty: bool) -> Result<(), AppError> {
    if value.is_empty() {
        return if allow_empty {
            Ok(())
        } else {
            Err(AppError::category_name_empty())
        };
    }
    for part in value.split('/') {
        let stem = part.split('.').next().unwrap_or("").to_ascii_uppercase();
        let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
            || (stem.len() == 4
                && (stem.starts_with("COM") || stem.starts_with("LPT"))
                && matches!(stem.as_bytes()[3], b'1'..=b'9'));
        if part.is_empty()
            || part == "."
            || part == ".."
            || part.trim() != part
            || part.ends_with('.')
            || part
                .chars()
                .any(|c| c.is_control() || "<>:\"\\|?*".contains(c))
            || reserved
        {
            return Err(AppError::category_name_invalid_chars());
        }
    }
    Ok(())
}

fn is_system(category: &str) -> bool {
    SYSTEM_ROOTS.iter().any(|root| {
        category
            .split('/')
            .next()
            .unwrap_or("")
            .eq_ignore_ascii_case(root)
    })
}

fn validate_custom(category: &str) -> Result<(), AppError> {
    validate_relative(category, false)?;
    if category
        .split('/')
        .any(|part| SYSTEM_ROOTS.iter().any(|r| part.eq_ignore_ascii_case(r)))
    {
        return Err(library_error("systemFolderProtected"));
    }
    Ok(())
}

fn is_link(metadata: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        metadata.file_attributes() & 0x400 != 0 // includes junctions and other reparse points
    }
    #[cfg(not(windows))]
    {
        metadata.file_type().is_symlink()
    }
}

// Recognize the storage wrappers by their layout, not a blanket ban on folder
// names. A user's ordinary notes/ or Projects/notes/ folder remains visible.
fn is_storage_directory(path: &Path) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    if ["images", "backgrounds"]
        .iter()
        .any(|name_| name.eq_ignore_ascii_case(name_))
    {
        return true;
    }
    let has_archive_roots = |dir: &Path| SYSTEM_ROOTS.iter().all(|root| dir.join(root).is_dir());
    if name.eq_ignore_ascii_case("floral-notepaper-regulusapplex") {
        return path.join("notes").is_dir()
            && (path.join("metadata.json").is_file() || has_archive_roots(&path.join("notes")));
    }
    name.eq_ignore_ascii_case("notes") && has_archive_roots(path)
}

fn walk(
    dir: &Path,
    base: &Path,
    folders: &mut Vec<String>,
    files: &mut Vec<(String, String)>,
) -> Result<(), AppError> {
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path)?;
        if is_link(&metadata) {
            continue;
        }
        if metadata.is_dir() {
            let relative = path
                .strip_prefix(base)
                .map_err(|_| library_error("unsafePath"))?
                .to_string_lossy()
                .replace('\\', "/");
            if validate_relative(&relative, false).is_err() {
                continue;
            }
            folders.push(relative);
            walk(&path, base, folders, files)?;
        } else if metadata.is_file() && is_markdown_path(&path) {
            let category = dir
                .strip_prefix(base)
                .map_err(|_| library_error("unsafePath"))?
                .to_string_lossy()
                .replace('\\', "/");
            files.push((category, entry.file_name().to_string_lossy().into_owned()));
        }
    }
    Ok(())
}

// Floral-managed images resolve against data/images/<id>, independently of folders.
// Conservatively refuse moves of unsupported relative images; never silently break them.
fn check_image_moves(content: &str) -> Result<(), AppError> {
    fn safe(target: &str) -> bool {
        let target = target.trim().trim_start_matches('<');
        target.starts_with("images/")
            || target.starts_with("http://")
            || target.starts_with("https://")
            || target.starts_with("data:")
            || target.starts_with("asset:")
            || target.starts_with("file:")
            || target.starts_with('/')
            || target.get(1..3) == Some(":/")
    }
    for rest in content.split("![").skip(1) {
        let Some((_, after)) = rest.split_once(']') else {
            continue;
        };
        let after = after.trim_start();
        if let Some(target) = after.strip_prefix('(') {
            if !safe(target) {
                return Err(library_error("relativeImageMove"));
            }
        } else {
            return Err(library_error("relativeImageMove"));
        }
    }
    for rest in content.split("src=").skip(1) {
        let target = rest.trim_start_matches(['"', '\'']);
        if !safe(target) {
            return Err(library_error("relativeImageMove"));
        }
    }
    Ok(())
}

fn note_from(metadata: NoteMetadata, content: String) -> Note {
    Note {
        id: metadata.id,
        title: metadata.title,
        file_name: metadata.file_name,
        category: metadata.category,
        record_type: metadata.record_type,
        record_period: metadata.record_period,
        created_at: metadata.created_at,
        updated_at: metadata.updated_at,
        word_count: metadata.word_count,
        content,
    }
}

impl NoteStore {
    pub(super) fn ensure_library_dirs(&self) -> Result<(), AppError> {
        self.ensure_data_dir()?;
        fs::create_dir_all(self.notes_dir())?;
        for name in SYSTEM_ROOTS {
            let path = self.checked_category_path(name)?;
            fs::create_dir_all(path)?;
        }
        Ok(())
    }

    fn checked_category_path(&self, category: &str) -> Result<PathBuf, AppError> {
        validate_relative(category, true)?;
        let base = self.notes_dir();
        let mut path = base.clone();
        // Refuse links even if their current target is inside the root.
        if base.exists() && is_link(&fs::symlink_metadata(&base)?) {
            return Err(library_error("unsafePath"));
        }
        for component in category.split('/').filter(|p| !p.is_empty()) {
            path.push(component);
            match fs::symlink_metadata(&path) {
                Ok(metadata) if is_link(&metadata) || !metadata.is_dir() => {
                    return Err(library_error("unsafePath"))
                }
                Ok(_) => (),
                Err(e) if e.kind() == io::ErrorKind::NotFound => (),
                Err(e) => return Err(e.into()),
            }
        }
        Ok(path)
    }

    pub(super) fn checked_note_path(
        &self,
        file_name: &str,
        category: &str,
    ) -> Result<PathBuf, AppError> {
        validate_relative(file_name, false)?;
        if file_name.contains('/') {
            return Err(library_error("unsafePath"));
        }
        let path = self.checked_category_path(category)?.join(file_name);
        if let Ok(metadata) = fs::symlink_metadata(&path) {
            if is_link(&metadata) || !metadata.is_file() {
                return Err(library_error("unsafePath"));
            }
        }
        Ok(path)
    }

    fn backup_path(&self) -> PathBuf {
        self.data_dir.join("metadata.backup.json")
    }

    pub(super) fn load_metadata(&self) -> Result<MetadataFile, AppError> {
        self.ensure_data_dir()?;
        let path = self.metadata_path();
        let metadata: MetadataFile = match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(metadata) => metadata,
                Err(_) => {
                    // Recovery uses a durable ownership index, never guessed filenames or dates.
                    let backup = fs::read_to_string(self.backup_path())
                        .map_err(|_| library_error("metadataRecoveryRequired"))?;
                    let metadata = serde_json::from_str(&backup)
                        .map_err(|_| library_error("metadataRecoveryRequired"))?;
                    fs::copy(
                        &path,
                        self.data_dir
                            .join(format!("metadata.corrupt-{}.json", Uuid::new_v4())),
                    )?;
                    write_json_atomic(&path, &metadata)?;
                    metadata
                }
            },
            Err(e) if e.kind() == io::ErrorKind::NotFound => {
                if self.backup_path().exists() {
                    let metadata = serde_json::from_str(&fs::read_to_string(self.backup_path())?)
                        .map_err(|_| library_error("metadataRecoveryRequired"))?;
                    write_json_atomic(&path, &metadata)?;
                    metadata
                } else {
                    let metadata = MetadataFile::default();
                    self.save_metadata(&metadata)?;
                    metadata
                }
            }
            Err(e) => return Err(e.into()),
        };
        for note in &metadata.notes {
            self.checked_note_path(&note.file_name, &note.category)?;
            if note.record_type != RecordType::Ordinary {
                period_folder(
                    note.record_type,
                    note.record_period.as_deref().unwrap_or(""),
                )?;
            }
        }
        // Seed a backup for private versions created before folder management.
        if !self.backup_path().exists() {
            write_json_atomic(&self.backup_path(), &metadata)?;
        }
        Ok(metadata)
    }

    pub(super) fn save_metadata(&self, metadata: &MetadataFile) -> Result<(), AppError> {
        self.ensure_data_dir()?;
        write_json_atomic(&self.metadata_path(), metadata)?;
        // The primary is already committed. A backup failure must not cause callers
        // to roll back files behind a successfully published primary index.
        if let Err(error) = write_json_atomic(&self.backup_path(), metadata) {
            eprintln!("metadata backup failed: {error}");
        }
        Ok(())
    }

    pub(super) fn reconcile_metadata(&self) -> Result<MetadataFile, AppError> {
        let mut metadata = self.load_metadata()?;
        let mut files = Vec::new();
        walk(
            &self.notes_dir(),
            &self.notes_dir(),
            &mut Vec::new(),
            &mut files,
        )?;
        let mut changed = false;
        for note in &mut metadata.notes {
            let path = self.checked_note_path(&note.file_name, &note.category)?;
            if !path.exists() {
                let matches: Vec<_> = files
                    .iter()
                    .filter(|(_, file)| id_from_file_name(file).as_deref() == Some(&note.id))
                    .collect();
                if matches.len() == 1 {
                    note.category = matches[0].0.clone();
                    note.file_name = matches[0].1.clone();
                    changed = true;
                }
            }
            let current_path = self.checked_note_path(&note.file_name, &note.category)?;
            if current_path.is_file() {
                let content = fs::read_to_string(&current_path)?;
                let current_preview = preview(&content);
                let current_count = count_words(&content);
                if note.preview != current_preview || note.word_count != current_count {
                    note.preview = current_preview;
                    note.word_count = current_count;
                    note.updated_at = fs::metadata(&current_path)?
                        .modified()
                        .map(DateTime::<Utc>::from)
                        .unwrap_or(note.updated_at);
                    changed = true;
                }
            }
            // Missing or ambiguous identities stay in the index for explicit recovery.
        }
        if changed {
            self.save_metadata(&metadata)?;
        }
        Ok(metadata)
    }

    pub fn list_notes(&self) -> Result<Vec<NoteMetadata>, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        let mut notes = self.reconcile_metadata()?.notes;
        notes.retain(|n| {
            self.checked_note_path(&n.file_name, &n.category)
                .is_ok_and(|p| p.is_file())
        });
        notes.sort_by_key(|note| std::cmp::Reverse(note.created_at));
        Ok(notes)
    }

    pub fn read_note(&self, id: &str) -> Result<Note, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        self.reconcile_metadata()?;
        self.read_note_locked(id)
    }

    fn read_note_locked(&self, id: &str) -> Result<Note, AppError> {
        let metadata = self.find_metadata(id)?;
        let content =
            fs::read_to_string(self.checked_note_path(&metadata.file_name, &metadata.category)?)?;
        Ok(note_from(metadata, content))
    }

    fn check_destination(
        &self,
        category: &str,
        kind: RecordType,
        period: Option<&str>,
    ) -> Result<(), AppError> {
        self.checked_category_path(category)?;
        if category.is_empty() || category == "tiles" {
            return Ok(());
        }
        if !is_system(category) {
            return validate_custom(category);
        }
        if kind != RecordType::Ordinary && period_folder(kind, period.unwrap_or(""))? == category {
            return Ok(());
        }
        Err(library_error("systemFolderProtected"))
    }

    pub fn create_note(&self, request: SaveNoteRequest) -> Result<Note, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        self.check_destination(&request.category, RecordType::Ordinary, None)?;
        self.create_note_locked(request, RecordType::Ordinary, None)
    }

    fn create_note_locked(
        &self,
        request: SaveNoteRequest,
        kind: RecordType,
        period: Option<String>,
    ) -> Result<Note, AppError> {
        let mut metadata = self.load_metadata()?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now();
        let note = NoteMetadata {
            file_name: self.file_name_for(&id, &request.title),
            id,
            title: request.title,
            category: request.category,
            record_type: kind,
            record_period: period,
            created_at: now,
            updated_at: now,
            word_count: count_words(&request.content),
            preview: preview(&request.content),
        };
        let path = self.checked_note_path(&note.file_name, &note.category)?;
        fs::create_dir_all(path.parent().unwrap())?;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)?;
        file.write_all(request.content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        metadata.notes.push(note.clone());
        if let Err(error) = self.save_metadata(&metadata) {
            let _ = fs::remove_file(&path);
            return Err(error);
        }
        Ok(note_from(note, request.content))
    }

    pub fn create_period_note(&self, request: PeriodNoteRequest) -> Result<Note, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        let category = period_folder(request.record_type, &request.record_period)?;
        let metadata = self.reconcile_metadata()?;
        if let Some(existing) = metadata.notes.iter().find(|n| {
            n.record_type == request.record_type
                && n.record_period.as_deref() == Some(&request.record_period)
        }) {
            return self.read_note_locked(&existing.id);
        }
        self.create_note_locked(
            SaveNoteRequest {
                title: request.title,
                content: request.content,
                category,
            },
            request.record_type,
            Some(request.record_period),
        )
    }

    pub fn update_note(&self, id: &str, request: SaveNoteRequest) -> Result<Note, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        let mut metadata = self.reconcile_metadata()?;
        let note = metadata
            .notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| AppError::note_not_found(id))?;
        // Content saves from an already open tile may contain a stale category.
        // Moving is a separate command; saves must not undo a move.
        let old_path = self.checked_note_path(&note.file_name, &note.category)?;
        if !old_path.is_file() {
            return Err(AppError::note_not_found(id));
        }
        let file_name = self.file_name_for(id, &request.title);
        let path = self.checked_note_path(&file_name, &note.category)?;
        if path.exists() && !paths_refer_to_same_entry(&old_path, &path) {
            return Err(library_error("fileAlreadyExists"));
        }
        let previous = fs::read(&old_path)?;
        // Write through a unique sibling file so a crash cannot truncate the old Markdown.
        let temp = path.with_extension(format!("{}.tmp", Uuid::new_v4()));
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(request.content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        fs::rename(&temp, &path)?;
        note.file_name = file_name;
        note.title = request.title;
        note.updated_at = Utc::now();
        note.word_count = count_words(&request.content);
        note.preview = preview(&request.content);
        let result = note_from(note.clone(), request.content);
        if let Err(error) = self.save_metadata(&metadata) {
            if paths_refer_to_same_entry(&old_path, &path) {
                let _ = fs::write(&old_path, previous);
            } else {
                let _ = fs::remove_file(&path);
            }
            return Err(error);
        }
        if old_path.exists() && !paths_refer_to_same_entry(&old_path, &path) {
            let _ = recycle_path(&old_path);
        }
        Ok(result)
    }

    pub fn list_categories(&self) -> Result<Vec<String>, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        let mut folders = Vec::new();
        walk(
            &self.notes_dir(),
            &self.notes_dir(),
            &mut folders,
            &mut Vec::new(),
        )?;
        let hidden_roots: Vec<_> = folders
            .iter()
            .filter(|folder| !folder.contains('/'))
            .filter(|folder| is_storage_directory(&self.notes_dir().join(folder)))
            .cloned()
            .collect();
        folders.retain(|folder| {
            !hidden_roots
                .iter()
                .any(|root| folder == root || folder.starts_with(&format!("{root}/")))
        });
        folders.sort();
        Ok(folders)
    }

    pub fn create_category(&self, name: &str) -> Result<(), AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        validate_custom(name)?;
        let path = self.checked_category_path(name)?;
        if path.exists() {
            return Err(AppError::category_already_exists(name));
        }
        fs::create_dir_all(path)?;
        Ok(())
    }

    pub fn rename_category(&self, old_name: &str, new_name: &str) -> Result<(), AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        validate_custom(old_name)?;
        validate_custom(new_name)?;
        if new_name
            .to_lowercase()
            .starts_with(&format!("{}/", old_name.to_lowercase()))
        {
            return Err(library_error("unsafePath"));
        }
        let from = self.checked_category_path(old_name)?;
        let to = self.checked_category_path(new_name)?;
        if !from.is_dir() {
            return Err(AppError::category_not_found(old_name));
        }
        if to.exists() {
            return Err(AppError::category_already_exists(new_name));
        }
        let mut metadata = self.reconcile_metadata()?;
        // Unmanaged Markdown also moves with the real folder: validate its images too.
        let mut files = Vec::new();
        walk(&from, &from, &mut Vec::new(), &mut files)?;
        for (category, file) in files {
            check_image_moves(&fs::read_to_string(from.join(category).join(file))?)?;
        }
        for note in &mut metadata.notes {
            if note.category == old_name || note.category.starts_with(&format!("{old_name}/")) {
                note.category = format!("{new_name}{}", &note.category[old_name.len()..]);
            }
        }
        fs::create_dir_all(to.parent().unwrap())?;
        fs::rename(&from, &to)?;
        if let Err(error) = self.save_metadata(&metadata) {
            let _ = fs::rename(&to, &from);
            return Err(error);
        }
        Ok(())
    }

    pub fn delete_category(&self, name: &str) -> Result<(), AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        validate_custom(name)?;
        let path = self.checked_category_path(name)?;
        if !path.is_dir() {
            return Err(AppError::category_not_found(name));
        }
        if fs::read_dir(&path)?.next().is_some() {
            return Err(library_error("folderNotEmpty"));
        }
        fs::remove_dir(path)?;
        Ok(())
    }

    fn move_note_locked(
        &self,
        note: &mut NoteMetadata,
        category: &str,
    ) -> Result<Option<(PathBuf, PathBuf)>, AppError> {
        self.check_destination(category, note.record_type, note.record_period.as_deref())?;
        if note.category == category {
            return Ok(None);
        }
        let from = self.checked_note_path(&note.file_name, &note.category)?;
        let to = self.checked_note_path(&note.file_name, category)?;
        if to.exists() {
            return Err(library_error("fileAlreadyExists"));
        }
        check_image_moves(&fs::read_to_string(&from)?)?;
        fs::create_dir_all(to.parent().unwrap())?;
        fs::rename(&from, &to)?;
        note.category = category.to_string();
        Ok(Some((from, to)))
    }

    pub fn move_note_to_category(
        &self,
        id: &str,
        category: &str,
    ) -> Result<NoteMetadata, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        let mut metadata = self.reconcile_metadata()?;
        let note = metadata
            .notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| AppError::note_not_found(id))?;
        let moved = self.move_note_locked(note, category)?;
        let result = note.clone();
        if let Err(error) = self.save_metadata(&metadata) {
            if let Some((from, to)) = moved {
                let _ = fs::rename(to, from);
            }
            return Err(error);
        }
        Ok(result)
    }

    pub fn set_note_record(
        &self,
        id: &str,
        kind: RecordType,
        period: &str,
        move_to_standard: bool,
    ) -> Result<Note, AppError> {
        let _guard = STORAGE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        self.ensure_storage()?;
        let canonical = period_folder(kind, period)?;
        let mut metadata = self.reconcile_metadata()?;
        if metadata.notes.iter().any(|n| {
            n.id != id && n.record_type == kind && n.record_period.as_deref() == Some(period)
        }) {
            return Err(library_error("recordPeriodConflict"));
        }
        let note = metadata
            .notes
            .iter_mut()
            .find(|n| n.id == id)
            .ok_or_else(|| AppError::note_not_found(id))?;
        // Verify the source before changing any identity/period information.
        fs::read_to_string(self.checked_note_path(&note.file_name, &note.category)?)?;
        note.record_type = kind;
        note.record_period = Some(period.to_string());
        let moved = if move_to_standard {
            self.move_note_locked(note, &canonical)?
        } else {
            None
        };
        if let Err(error) = self.save_metadata(&metadata) {
            if let Some((from, to)) = moved {
                let _ = fs::rename(to, from);
            }
            return Err(error);
        }
        self.read_note_locked(id)
    }
}
