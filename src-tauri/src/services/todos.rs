use super::notes::{default_config_dir, normalize_tile_opacity, AppError};
use crate::json_io::write_json_atomic;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path, sync::Mutex};

static TODO_LOCK: Mutex<()> = Mutex::new(());

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TodoItem {
    pub id: String,
    pub text: String,
    pub completed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TodoState {
    pub revision: u64,
    pub items: Vec<TodoItem>,
    pub opacity: f64,
}

impl Default for TodoState {
    fn default() -> Self {
        Self {
            revision: 0,
            items: Vec::new(),
            opacity: 0.45,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TodoAction {
    Add {
        id: String,
        text: String,
        #[serde(default)]
        after: Option<String>,
    },
    Edit {
        id: String,
        text: String,
    },
    Complete {
        id: String,
        completed: bool,
    },
    Delete {
        id: String,
    },
    Move {
        id: String,
        before: Option<String>,
    },
    Opacity {
        value: f64,
    },
}

fn invalid(message: &str) -> AppError {
    AppError {
        code: "invalidTodo".into(),
        message: message.into(),
        details: Default::default(),
    }
}

fn read(path: &Path) -> Result<TodoState, AppError> {
    if !path.exists() {
        return Ok(TodoState::default());
    }
    let mut state: TodoState = serde_json::from_str(&fs::read_to_string(path)?)?;
    state.opacity = normalize_tile_opacity(state.opacity);
    Ok(state)
}

fn apply(state: &mut TodoState, action: TodoAction) -> Result<(), AppError> {
    match action {
        TodoAction::Add { id, text, after } => {
            if id.is_empty() || text.trim().is_empty() {
                return Err(invalid("A task needs an ID and text"));
            }
            // Retrying an acknowledged-but-lost IPC response must not add a second task.
            if state.items.iter().any(|item| item.id == id) {
                return Ok(());
            }
            let index = after
                .and_then(|id| state.items.iter().position(|item| item.id == id))
                .map(|index| index + 1)
                .unwrap_or(state.items.len());
            state.items.insert(
                index,
                TodoItem {
                    id,
                    text: text.trim().into(),
                    completed: false,
                },
            );
        }
        TodoAction::Edit { id, text } => {
            if text.trim().is_empty() {
                return Err(invalid("A task cannot be empty"));
            }
            // Another window may have deleted it while this edit was in flight.
            // Deletion wins; a stale action must not block every later save.
            if let Some(item) = state.items.iter_mut().find(|item| item.id == id) {
                item.text = text.trim().into();
            }
        }
        TodoAction::Complete { id, completed } => {
            if let Some(item) = state.items.iter_mut().find(|item| item.id == id) {
                item.completed = completed;
            }
        }
        TodoAction::Delete { id } => state.items.retain(|item| item.id != id),
        TodoAction::Move { id, before } => {
            if before.as_ref() == Some(&id) {
                return Ok(());
            }
            if let Some(index) = state.items.iter().position(|item| item.id == id) {
                let item = state.items.remove(index);
                let index = before
                    .and_then(|id| state.items.iter().position(|item| item.id == id))
                    .unwrap_or(state.items.len());
                state.items.insert(index, item);
            }
        }
        TodoAction::Opacity { value } => state.opacity = normalize_tile_opacity(value),
    }
    Ok(())
}

fn mutate_at(path: &Path, action: TodoAction) -> Result<TodoState, AppError> {
    let _guard = TODO_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut state = read(path)?;
    apply(&mut state, action)?;
    state.revision = state
        .revision
        .checked_add(1)
        .ok_or_else(|| invalid("Task revision overflow"))?;
    write_json_atomic(path, &state)?;
    Ok(state)
}

pub fn load() -> Result<TodoState, AppError> {
    let _guard = TODO_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    read(&default_config_dir()?.join("todos.json"))
}

pub fn mutate(action: TodoAction) -> Result<TodoState, AppError> {
    mutate_at(&default_config_dir()?.join("todos.json"), action)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn concurrent_actions_keep_both_tasks_and_independent_opacity() {
        let root = std::env::temp_dir().join(format!("floral-todos-{}", uuid::Uuid::new_v4()));
        let path = root.join("todos.json");
        std::thread::scope(|scope| {
            for id in ["a", "b"] {
                let path = &path;
                scope.spawn(move || {
                    mutate_at(
                        path,
                        TodoAction::Add {
                            id: id.into(),
                            text: id.into(),
                            after: None,
                        },
                    )
                    .unwrap()
                });
            }
        });
        mutate_at(
            &path,
            TodoAction::Add {
                id: "a".into(),
                text: "retry".into(),
                after: None,
            },
        )
        .unwrap();
        mutate_at(
            &path,
            TodoAction::Complete {
                id: "a".into(),
                completed: true,
            },
        )
        .unwrap();
        mutate_at(&path, TodoAction::Opacity { value: 0.123 }).unwrap();
        let state = read(&path).unwrap();
        assert_eq!(state.items.len(), 2);
        assert_eq!(
            state.items.iter().find(|item| item.id == "a").unwrap().text,
            "a"
        );
        assert!(
            state
                .items
                .iter()
                .find(|item| item.id == "a")
                .unwrap()
                .completed
        );
        assert_eq!(state.opacity, 0.1);
        assert_eq!(state.revision, 5);
        assert!(!root.join("metadata.json").exists());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn edits_reorders_and_failed_validation_preserve_storage() {
        let root = std::env::temp_dir().join(format!("floral-todos-{}", uuid::Uuid::new_v4()));
        let path = root.join("todos.json");
        for id in ["a", "b", "c"] {
            mutate_at(
                &path,
                TodoAction::Add {
                    id: id.into(),
                    text: id.into(),
                    after: None,
                },
            )
            .unwrap();
        }
        mutate_at(
            &path,
            TodoAction::Edit {
                id: "b".into(),
                text: "first\nsecond".into(),
            },
        )
        .unwrap();
        mutate_at(
            &path,
            TodoAction::Move {
                id: "c".into(),
                before: Some("a".into()),
            },
        )
        .unwrap();
        let before = read(&path).unwrap();
        assert_eq!(
            before
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["c", "a", "b"]
        );
        assert!(mutate_at(
            &path,
            TodoAction::Edit {
                id: "b".into(),
                text: "  ".into()
            }
        )
        .is_err());
        assert_eq!(read(&path).unwrap(), before);
        mutate_at(&path, TodoAction::Delete { id: "a".into() }).unwrap();
        assert_eq!(read(&path).unwrap().items.len(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}
