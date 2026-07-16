//! Supervises the node SSR child process in the all-in-one image.
//!
//! The Rust server is PID-adjacent to `tini -g` (which forwards SIGTERM to the
//! whole process group, taking the node child down with us). Our job here is
//! only to start the child and restart it if it crashes.

use std::time::Duration;

/// Spawn `command` (whitespace-split) and restart it whenever it exits.
///
/// Runs as a background tokio task for the lifetime of the server.
pub fn spawn_supervised(command: String) {
    tokio::spawn(async move {
        let mut backoff = Duration::from_millis(500);
        loop {
            let mut parts = command.split_whitespace();
            let Some(program) = parts.next() else {
                tracing::error!("WEFT_SSR_COMMAND is empty; SSR will not start");
                return;
            };
            let args: Vec<&str> = parts.collect();

            tracing::info!(%command, "starting SSR process");
            match tokio::process::Command::new(program)
                .args(&args)
                .kill_on_drop(true)
                .spawn()
            {
                Ok(mut child) => {
                    let started = std::time::Instant::now();
                    let status = child.wait().await;
                    tracing::warn!(?status, "SSR process exited; restarting");
                    // Reset backoff after a healthy stretch, grow it on crash loops.
                    if started.elapsed() > Duration::from_secs(30) {
                        backoff = Duration::from_millis(500);
                    } else {
                        backoff = (backoff * 2).min(Duration::from_secs(15));
                    }
                }
                Err(err) => {
                    tracing::error!(%err, "failed to spawn SSR process");
                    backoff = (backoff * 2).min(Duration::from_secs(15));
                }
            }
            tokio::time::sleep(backoff).await;
        }
    });
}
