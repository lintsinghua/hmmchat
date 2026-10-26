mod http;
mod secrets;

use tauri::Manager;
use tauri_plugin_sql::{Migration, MigrationKind};

// iOS and Android start the app from a library entry point rather than `main`.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "initial schema",
            sql: include_str!("../migrations/001_init.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "message attachments",
            sql: include_str!("../migrations/002_attachments.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "fork provenance",
            sql: include_str!("../migrations/003_fork.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "provider reasoning wire",
            sql: include_str!("../migrations/004_reasoning_wire.sql"),
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "turn skipped lanes",
            sql: include_str!("../migrations/005_turn_skipped_lanes.sql"),
            kind: MigrationKind::Up,
        },
    ];

    let builder = tauri::Builder::default().plugin(tauri_plugin_opener::init());
    // Window size and position mean nothing on a phone, where the one window is
    // the screen; the plugin is desktop-only.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_window_state::Builder::default().build());

    builder
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:hmmchat.db", migrations)
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            app.manage(secrets::SecretsState::load(&dir));
            app.manage(http::HttpState::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            http::http_stream,
            http::http_abort,
            secrets::secret_set,
            secrets::secret_delete,
            secrets::secret_names,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HmmChat");
}
