// src/handlers/analysis.rs

//! Analysis handlers for checking video/funscript duration gaps and funscript volatility.
//! TODO: get this in the front end (badges maybe? idk yet)

use crate::buttplug::funscript_utils::{FunscriptData};
use actix_web::{HttpResponse, Responder};
use std::{
    env,
    path::{Path, PathBuf},
};
use walkdir::WalkDir;

// ── Duration Analysis ──────────────────────────────────────────────────

struct DurationResult {
    filename: String,
    video_sec: u64,
    script_sec: u64,
    delta: i64,
}

async fn get_video_duration_ffprobe(video_path: &Path) -> Option<u64> {
    let output = tokio::process::Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            video_path.to_str()?,
        ])
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let stdout_str = std::str::from_utf8(&output.stdout).ok()?.trim();
    let seconds_f64 = stdout_str.parse::<f64>().ok()?;
    Some(seconds_f64.round() as u64)
}

fn get_script_duration_sec(script_path: &Path) -> Option<u64> {
    let content = std::fs::read_to_string(script_path).ok()?;
    let data: FunscriptData = serde_json::from_str(&content).ok()?;
    let last_action = data.actions.last()?;
    Some(last_action.at / 1000)
}

pub async fn handle_check_durations() -> impl Responder {
    let video_dir = match env::var("VIDEO_SHARE_PATH") {
        Ok(v) => PathBuf::from(v),
        Err(_) => return HttpResponse::InternalServerError().body("VIDEO_SHARE_PATH not set"),
    };
    let funscript_dir = match env::var("FUNSCRIPT_SHARE_PATH") {
        Ok(f) => PathBuf::from(f),
        Err(_) => return HttpResponse::InternalServerError().body("FUNSCRIPT_SHARE_PATH not set"),
    };

    let video_extensions = ["mp4", "mkv", "avi", "mov"];
    let mut results = Vec::new();

    let walker = WalkDir::new(&video_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file());

    for entry in walker {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        if !video_extensions.contains(&ext.as_str()) {
            continue;
        }

        let rel_path = match path.strip_prefix(&video_dir) {
            Ok(p) => p,
            Err(_) => continue,
        };

        let funscript_path = funscript_dir
            .join(rel_path)
            .with_extension("funscript");

        if !funscript_path.exists() {
            continue;
        }

        let v_sec = match get_video_duration_ffprobe(path).await {
            Some(s) => s,
            None => continue,
        };

        let s_sec = match get_script_duration_sec(&funscript_path) {
            Some(s) => s,
            None => continue,
        };

        let filename = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();

        let delta = v_sec as i64 - s_sec as i64;
        results.push(DurationResult {
            filename,
            video_sec: v_sec,
            script_sec: s_sec,
            delta,
        });
    }

    results.sort_by(|a, b| b.delta.cmp(&a.delta));

    let mut rows_html = String::new();
    for item in &results {
        rows_html.push_str(&format!(
            "<tr><td>{}</td><td>{}s</td><td>{}s</td><td><strong>{}s shorter</strong></td></tr>",
            html_escape(&item.filename),
            item.video_sec,
            item.script_sec,
            item.delta
        ));
    }

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Duration Gaps Analysis</title>
    <style>
        body {{ font-family: monospace, sans-serif; background: #1a1a1a; color: #dcdcdc; padding: 20px; }}
        h1 {{ color: #ffd54f; }}
        table {{ border-collapse: collapse; width: 100%; margin-top: 15px; }}
        th, td {{ padding: 10px; border: 1px solid #444; text-align: left; }}
        th {{ background: #252525; color: #4caf50; }}
        tr:nth-child(even) {{ background: #232323; }}
        tr:hover {{ background: #333; }}
    </style>
</head>
<body>
    <h1>Duration Gaps Analysis ({count} files)</h1>
    <table>
        <thead>
            <tr><th>File Name</th><th>Video Duration</th><th>Script Duration</th><th>Gap (Delta)</th></tr>
        </thead>
        <tbody>
            {rows}
        </tbody>
    </table>
</body>
</html>"#,
        count = results.len(),
        rows = rows_html
    );

    HttpResponse::Ok().content_type("text/html; charset=utf-8").body(html)
}

fn html_escape(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
