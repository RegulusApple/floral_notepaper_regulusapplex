#[cfg(test)]
mod tests {
    use super::super::*;
    struct Fixture(NoteStore, PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = env::temp_dir().join(format!("floral-library-{}", Uuid::new_v4()));
            Self(NoteStore::new(path.join("config"), path.join("data")), path)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.1);
        }
    }
    fn request(kind: RecordType, period: &str) -> PeriodNoteRequest {
        PeriodNoteRequest {
            record_type: kind,
            record_period: period.into(),
            title: format!("{period} record"),
            content: "# Original\n\nBody".into(),
        }
    }
    fn ordinary(store: &NoteStore, category: &str) -> Note {
        store
            .create_note(SaveNoteRequest {
                title: "Ordinary".into(),
                content: "text".into(),
                category: category.into(),
            })
            .unwrap()
    }

    #[test]
    fn canonical_periods_use_iso_year_and_thursday_month() {
        for (kind, period, folder) in [
            (RecordType::Diary, "2021-01-01", "diary/2020/2020-W53"),
            (RecordType::Diary, "2024-12-30", "diary/2025/2025-W01"),
            (RecordType::Weekly, "2025-W01", "weekly/2025/01"),
            (RecordType::Weekly, "2020-W53", "weekly/2020/12"),
            (RecordType::Weekly, "2026-W40", "weekly/2026/10"),
            (RecordType::Monthly, "2024-02", "monthly/2024"),
        ] {
            assert_eq!(period_folder(kind, period).unwrap(), folder);
        }
        for (kind, period) in [
            (RecordType::Diary, "2023-02-29"),
            (RecordType::Diary, "2024-2-29"),
            (RecordType::Weekly, "2021-W53"),
            (RecordType::Weekly, "2025-W00"),
            (RecordType::Monthly, "2026-13"),
            (RecordType::Monthly, "0001-01"),
        ] {
            assert_eq!(
                period_folder(kind, period).unwrap_err().code,
                "recordPeriodInvalid"
            );
        }
    }

    #[test]
    fn initial_roots_are_empty_and_unknown_markdown_is_not_owned() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        assert_eq!(
            store.list_categories().unwrap(),
            vec!["diary", "monthly", "tiles", "weekly"]
        );
        fs::write(store.notes_dir().join("unknown.md"), "# No import").unwrap();
        assert!(store.list_notes().unwrap().is_empty());
        let imported = store
            .import_markdown_file(&store.notes_dir().join("unknown.md"), "")
            .unwrap();
        assert_eq!(imported.record_type, RecordType::Ordinary);
        assert_eq!(store.list_notes().unwrap().len(), 1);
        assert!(store.notes_dir().join("unknown.md").exists());
    }

    #[test]
    fn duplicate_period_opens_same_note_after_manual_move_and_edit() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let note = store
            .create_period_note(request(RecordType::Diary, "2024-02-29"))
            .unwrap();
        store.create_category("Work/Personal").unwrap();
        store
            .move_note_to_category(&note.id, "Work/Personal")
            .unwrap();
        let edited = store
            .update_note(
                &note.id,
                SaveNoteRequest {
                    title: "Renamed".into(),
                    content: "My edited text".into(),
                    category: note.category,
                },
            )
            .unwrap();
        let reopened = store
            .create_period_note(request(RecordType::Diary, "2024-02-29"))
            .unwrap();
        assert_eq!(edited, reopened);
        assert_eq!(reopened.category, "Work/Personal");
        assert_eq!(reopened.created_at, note.created_at);
        assert_eq!(store.list_notes().unwrap().len(), 1);
    }

    #[test]
    fn technical_wrappers_are_hidden_without_changing_their_contents() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let base = store.notes_dir();
        let wrapper = base.join("floral-notepaper-regulusapplex");
        for root in SYSTEM_ROOTS {
            fs::create_dir_all(wrapper.join("notes").join(root)).unwrap();
            fs::create_dir_all(base.join("notes").join(root)).unwrap();
        }
        fs::write(wrapper.join("metadata.json"), b"{\"notes\":[]}").unwrap();
        let content = "Do not move, copy or import this file";
        let source = wrapper.join("notes/diary/kept.md");
        fs::write(&source, content).unwrap();
        fs::create_dir_all(base.join("images/note-id")).unwrap();
        fs::create_dir_all(base.join("backgrounds")).unwrap();
        fs::create_dir_all(base.join("Projects/notes")).unwrap();
        let before = fs::read(wrapper.join("metadata.json")).unwrap();

        assert_eq!(
            store.list_categories().unwrap(),
            [
                "Projects",
                "Projects/notes",
                "diary",
                "monthly",
                "tiles",
                "weekly"
            ]
        );
        assert!(store.list_notes().unwrap().is_empty());
        assert_eq!(fs::read_to_string(source).unwrap(), content);
        assert_eq!(fs::read(wrapper.join("metadata.json")).unwrap(), before);
        assert!(!base.join("diary/kept.md").exists());
        assert!(base.join("notes/diary").is_dir());
    }

    #[test]
    fn ordinary_custom_folders_named_notes_remain_usable() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        for category in [
            "notes",
            "Projects/notes",
            "floral-notepaper-regulusapplex",
            "Document",
        ] {
            store.create_category(category).unwrap();
            let note = ordinary(store, category);
            assert_eq!(store.read_note(&note.id).unwrap().category, category);
            assert!(store
                .list_categories()
                .unwrap()
                .contains(&category.to_string()));
        }
    }

    #[test]
    fn concurrent_creation_is_unique() {
        let fixture = Fixture::new();
        let handles: Vec<_> = (0..12)
            .map(|_| {
                let store = fixture.0.clone();
                std::thread::spawn(move || {
                    store
                        .create_period_note(request(RecordType::Weekly, "2026-W40"))
                        .unwrap()
                        .id
                })
            })
            .collect();
        let ids: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        assert!(ids.iter().all(|id| id == &ids[0]));
        assert_eq!(fixture.0.list_notes().unwrap().len(), 1);
    }

    #[test]
    fn adopting_and_changing_period_preserves_body_and_rejects_conflicts() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let first = ordinary(store, "");
        let second = ordinary(store, "tiles");
        let adopted = store
            .set_note_record(&first.id, RecordType::Monthly, "2026-09", false)
            .unwrap();
        assert_eq!(adopted.category, first.category);
        assert_eq!(adopted.content, first.content);
        assert_eq!(adopted.created_at, first.created_at);
        assert_eq!(
            store
                .set_note_record(&second.id, RecordType::Monthly, "2026-09", true)
                .unwrap_err()
                .code,
            "recordPeriodConflict"
        );
        assert_eq!(store.read_note(&second.id).unwrap(), second);
        let moved = store
            .set_note_record(&first.id, RecordType::Monthly, "2026-10", true)
            .unwrap();
        assert_eq!(moved.category, "monthly/2026");
        assert_eq!(moved.content, first.content);
        assert_eq!(moved.updated_at, first.updated_at);
        assert_eq!(moved.record_period.as_deref(), Some("2026-10"));
    }

    #[test]
    fn nested_folder_move_updates_all_descendants_without_changing_dates_or_images() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        store.create_category("Projects/One/Notes").unwrap();
        let note = ordinary(store, "Projects/One/Notes");
        let image = store.save_image(&note.id, b"png", "png").unwrap();
        let note = store
            .update_note(
                &note.id,
                SaveNoteRequest {
                    title: note.title,
                    content: format!("![photo]({image})"),
                    category: note.category,
                },
            )
            .unwrap();
        store
            .rename_category("Projects/One", "Archive/Two")
            .unwrap();
        let moved = store.read_note(&note.id).unwrap();
        assert_eq!(moved.category, "Archive/Two/Notes");
        assert_eq!(moved.created_at, note.created_at);
        assert_eq!(moved.updated_at, note.updated_at);
        assert_eq!(moved.content, note.content);
        assert!(store.data_dir.join(image).is_file());
        assert!(store
            .list_categories()
            .unwrap()
            .contains(&"Archive/Two/Notes".into()));
        assert_eq!(
            store.delete_category("Archive").unwrap_err().code,
            "folderNotEmpty"
        );
        store.create_category("Empty").unwrap();
        store.delete_category("Empty").unwrap();
        assert!(!store.notes_dir().join("Empty").exists());
    }

    #[test]
    fn folder_validation_rejects_traversal_reserved_roots_and_descendant_moves() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        for path in [
            "../escape",
            "/absolute",
            "C:/escape",
            "a//b",
            "a/../b",
            "a\\b",
            "CON",
            "a/NUL.md",
            "a.",
            " x",
        ] {
            assert!(store.create_category(path).is_err(), "{path}");
        }
        for path in ["diary", "DIARY/foo", "x/monthly", "tiles/sub"] {
            assert_eq!(
                store.create_category(path).unwrap_err().code,
                "systemFolderProtected"
            );
        }
        store.create_category("A/B").unwrap();
        assert_eq!(
            store.rename_category("A", "A/B/C").unwrap_err().code,
            "unsafePath"
        );
        assert_eq!(
            store.delete_category("tiles").unwrap_err().code,
            "systemFolderProtected"
        );
        assert!(store
            .create_note(SaveNoteRequest {
                title: "".into(),
                content: "".into(),
                category: "../escape".into()
            })
            .is_err());
        assert!(store
            .create_note(SaveNoteRequest {
                title: "".into(),
                content: "".into(),
                category: "diary/2026".into()
            })
            .is_err());
    }

    #[test]
    fn corruption_recovery_preserves_ownership_period_and_creation_time() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let note = store
            .create_period_note(request(RecordType::Weekly, "2026-W40"))
            .unwrap();
        fs::write(store.notes_dir().join("unowned.md"), "# Not mine").unwrap();
        fs::write(store.metadata_path(), "{ broken").unwrap();
        assert_eq!(store.list_notes().unwrap().len(), 1);
        assert_eq!(store.read_note(&note.id).unwrap(), note);
        fs::remove_file(store.metadata_path()).unwrap();
        assert_eq!(store.read_note(&note.id).unwrap(), note);
        fs::write(store.metadata_path(), "{ broken").unwrap();
        fs::write(store.backup_path(), "{ broken").unwrap();
        assert_eq!(
            store.list_notes().unwrap_err().code,
            "metadataRecoveryRequired"
        );
        assert!(store
            .notes_dir()
            .join(&note.category)
            .join(&note.file_name)
            .is_file());
    }

    #[test]
    fn refresh_reconciles_owned_external_moves_recursively_only() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let note = ordinary(store, "");
        fs::create_dir_all(store.notes_dir().join("External/Deep")).unwrap();
        let filename = format!("{}_ExternalName.md", note.id);
        fs::rename(
            store.notes_dir().join(&note.file_name),
            store.notes_dir().join("External/Deep").join(&filename),
        )
        .unwrap();
        fs::write(
            store.notes_dir().join("External/Deep/unknown.md"),
            "# Ignore",
        )
        .unwrap();
        let notes = store.list_notes().unwrap();
        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].category, "External/Deep");
        assert_eq!(notes[0].file_name, filename);
        assert_eq!(notes[0].created_at, note.created_at);
    }

    #[test]
    fn unmanaged_relative_images_and_target_collisions_never_break_source() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let note = store
            .create_note(SaveNoteRequest {
                title: "Images".into(),
                content: "![x](../pic.png)".into(),
                category: "".into(),
            })
            .unwrap();
        store.create_category("Destination").unwrap();
        assert_eq!(
            store
                .move_note_to_category(&note.id, "Destination")
                .unwrap_err()
                .code,
            "relativeImageMove"
        );
        assert_eq!(store.read_note(&note.id).unwrap(), note);
        let ordinary = ordinary(store, "");
        fs::write(
            store
                .notes_dir()
                .join("Destination")
                .join(&ordinary.file_name),
            "do not overwrite",
        )
        .unwrap();
        assert_eq!(
            store
                .move_note_to_category(&ordinary.id, "Destination")
                .unwrap_err()
                .code,
            "fileAlreadyExists"
        );
        assert_eq!(store.read_note(&ordinary.id).unwrap(), ordinary);
    }

    #[test]
    fn deletion_reconciles_an_external_move_before_recycling() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let note = ordinary(store, "");
        let folder = store.notes_dir().join("External/Deep");
        fs::create_dir_all(&folder).unwrap();
        let destination = folder.join(&note.file_name);
        fs::rename(store.notes_dir().join(&note.file_name), &destination).unwrap();
        store.delete_note(&note.id).unwrap();
        assert!(!destination.exists());
        assert!(store.list_notes().unwrap().is_empty());
    }

    #[test]
    fn refresh_updates_owned_preview_without_changing_creation_time() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let note = ordinary(store, "");
        fs::write(
            store.notes_dir().join(&note.file_name),
            "Externally edited body",
        )
        .unwrap();
        let notes = store.list_notes().unwrap();
        assert_eq!(notes[0].preview, "Externally edited body");
        assert_eq!(notes[0].created_at, note.created_at);
    }

    #[test]
    fn ordinary_and_tile_notes_remain_sorted_by_creation_after_edit() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        let first = ordinary(store, "tiles");
        let second = ordinary(store, "");
        store
            .update_note(
                &first.id,
                SaveNoteRequest {
                    title: "Edited".into(),
                    content: "Changed".into(),
                    category: "tiles".into(),
                },
            )
            .unwrap();
        assert_eq!(
            store
                .list_notes()
                .unwrap()
                .iter()
                .map(|n| &n.id)
                .collect::<Vec<_>>(),
            vec![&second.id, &first.id]
        );
    }

    #[cfg(windows)]
    #[test]
    fn rejects_windows_directory_junctions() {
        let fixture = Fixture::new();
        let store = &fixture.0;
        store.list_categories().unwrap();
        let outside = fixture.1.join("outside");
        fs::create_dir_all(&outside).unwrap();
        let junction = store.notes_dir().join("linked");
        let result = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(&junction)
            .arg(&outside)
            .output()
            .unwrap();
        assert!(result.status.success());
        assert_eq!(
            store.create_category("linked/escape").unwrap_err().code,
            "unsafePath"
        );
        assert!(!store.list_categories().unwrap().contains(&"linked".into()));
        // Remove the junction itself before fixture cleanup, never its target.
        fs::remove_dir(&junction).unwrap();
        assert!(outside.exists());
    }
}
