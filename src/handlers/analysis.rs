// src/handlers/analysis.rs

//! Analysis handlers for checking video/funscript duration gaps and funscript volatility.
//! TODO: get this in the front end (badges maybe? idk yet)

use crate::buttplug::funscript_utils::{self, FunscriptData};
use actix_web::{HttpResponse, Responder};
use std::{
    collections::{HashMap},
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

// ── Volatility Analysis ────────────────────────────────────────────────

#[derive(Clone)]
struct Section {
    duration: f64,
    peak_intensity: f64,
    mean_intensity: f64,
    bucket: String,
}

struct VolatilityResult {
    filename: String,
    volatility: f64,
    num_sections: usize,
    breakdown: String,
}

fn get_bucket(intensity: f64) -> String {
    let val = intensity.clamp(0.0, 100.0);
    let mut lower = (val / 10.0).floor() as u32 * 10;
    if lower >= 100 {
        lower = 90;
    }
    format!("{}-{}", lower, lower + 10)
}

fn compute_sections(curve: &[(f64, f64)]) -> Vec<Section> {
    if curve.is_empty() {
        return Vec::new();
    }

    let max_variation = 10.0;
    let min_duration = 1.0;
    let mut sections = Vec::new();
    let mut current_start_idx = 0;
    let mut i = 0;

    while i < curve.len() {
        let window = &curve[current_start_idx..=i];
        let c_min = window.iter().map(|p| p.1).fold(f64::INFINITY, f64::min);
        let c_max = window.iter().map(|p| p.1).fold(f64::NEG_INFINITY, f64::max);

        if c_max - c_min > max_variation {
            let end_idx = current_start_idx.max(i.saturating_sub(1));
            let sec_curve = &curve[current_start_idx..=end_idx];
            let sec_duration = sec_curve.last().unwrap().0 - sec_curve.first().unwrap().0;
            let sec_peak = sec_curve.iter().map(|p| p.1).fold(0.0, f64::max);
            let sec_mean = sec_curve.iter().map(|p| p.1).sum::<f64>() / sec_curve.len() as f64;

            sections.push(Section {
                duration: sec_duration,
                peak_intensity: sec_peak,
                mean_intensity: sec_mean,
                bucket: get_bucket(sec_peak),
            });

            current_start_idx = end_idx + 1;
            i = current_start_idx;
        } else if i == curve.len() - 1 {
            let sec_curve = &curve[current_start_idx..=i];
            let sec_duration = sec_curve.last().unwrap().0 - sec_curve.first().unwrap().0;
            let sec_peak = sec_curve.iter().map(|p| p.1).fold(0.0, f64::max);
            let sec_mean = sec_curve.iter().map(|p| p.1).sum::<f64>() / sec_curve.len() as f64;

            sections.push(Section {
                duration: sec_duration,
                peak_intensity: sec_peak,
                mean_intensity: sec_mean,
                bucket: get_bucket(sec_peak),
            });
            i += 1;
        } else {
            i += 1;
        }
    }

    // Iterative collapse
    let mut changed = true;
    while changed {
        changed = false;
        if sections.len() <= 1 {
            break;
        }

        let mut new_sections = vec![sections[0].clone()];
        for j in 1..sections.len() {
            let sec = &sections[j];
            let prev = new_sections.last_mut().unwrap();

            if sec.bucket == prev.bucket || sec.duration < min_duration || prev.duration < min_duration {
                let total_dur = prev.duration + sec.duration;
                let new_peak = prev.peak_intensity.max(sec.peak_intensity);
                let new_mean = if total_dur > 0.0 {
                    (prev.mean_intensity * prev.duration + sec.mean_intensity * sec.duration) / total_dur
                } else {
                    0.0
                };

                prev.duration = total_dur;
                prev.peak_intensity = new_peak;
                prev.mean_intensity = new_mean;
                prev.bucket = get_bucket(new_peak);
                changed = true;
            } else {
                new_sections.push(sec.clone());
            }
        }
        sections = new_sections;
    }

    sections
}

fn analyze_script_volatility(path: &Path) -> Option<VolatilityResult> {
    let content = std::fs::read_to_string(path).ok()?;
    let data: FunscriptData = serde_json::from_str(&content).ok()?;
    if data.actions.len() < 2 {
        return None;
    }

    let curve_actions = funscript_utils::actions_to_intensity_curve(&data.actions, &[]);
    if curve_actions.is_empty() {
        return None;
    }

    let curve: Vec<(f64, f64)> = curve_actions
        .iter()
        .map(|a| (a.at as f64 / 1000.0, a.pos))
        .collect();

    let sections = compute_sections(&curve);
    if sections.is_empty() {
        return None;
    }

    let total_duration_sec: f64 = sections.iter().map(|s| s.duration).sum();
    let num_sections = sections.len();
    if total_duration_sec <= 0.0 || num_sections == 0 {
        return None;
    }

    let avg_section_duration = total_duration_sec / num_sections as f64;

    let mut jumps = Vec::new();
    for i in 0..num_sections - 1 {
        jumps.push((sections[i + 1].mean_intensity - sections[i].mean_intensity).abs());
    }
    let avg_intensity_jump = if !jumps.is_empty() {
        jumps.iter().sum::<f64>() / jumps.len() as f64
    } else {
        0.0
    };

    let variance = sections
        .iter()
        .map(|s| (s.duration - avg_section_duration).powi(2))
        .sum::<f64>()
        / num_sections as f64;
    let std_dev_section_duration = variance.sqrt();

    let avg_duration_norm = (1.0 - (avg_section_duration - 5.0) / 25.0).clamp(0.0, 1.0);
    let avg_jump_norm = ((avg_intensity_jump - 5.0) / 35.0).clamp(0.0, 1.0);
    let std_dev_norm = (std_dev_section_duration / 15.0).clamp(0.0, 1.0);

    let raw_score = 0.50 * avg_duration_norm + 0.30 * avg_jump_norm + 0.20 * std_dev_norm;
    let volatility_rating = ((raw_score * 9.0 + 1.0).clamp(1.0, 10.0) * 10.0).round() / 10.0;

    let mut bucket_counts: HashMap<String, usize> = HashMap::new();
    for s in &sections {
        *bucket_counts.entry(s.bucket.clone()).or_insert(0) += 1;
    }

    let mut sorted_buckets: Vec<(u32, String, usize)> = bucket_counts
        .into_iter()
        .map(|(b, count)| {
            let lower_val = b.split('-').next().and_then(|v| v.parse::<u32>().ok()).unwrap_or(0);
            (lower_val, b, count)
        })
        .collect();
    sorted_buckets.sort_by_key(|item| item.0);

    let breakdown_str = sorted_buckets
        .into_iter()
        .map(|(_, b, count)| format!("{}x ({})", count, b))
        .collect::<Vec<_>>()
        .join(", ");

    let filename = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();

    Some(VolatilityResult {
        filename,
        volatility: volatility_rating,
        num_sections,
        breakdown: breakdown_str,
    })
}

pub async fn handle_check_volatility() -> impl Responder {
    let funscript_dir = match env::var("FUNSCRIPT_SHARE_PATH") {
        Ok(f) => PathBuf::from(f),
        Err(_) => return HttpResponse::InternalServerError().body("FUNSCRIPT_SHARE_PATH not set"),
    };

    let mut results = Vec::new();

    let walker = WalkDir::new(&funscript_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file());

    for entry in walker {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("funscript") {
            if let Some(res) = analyze_script_volatility(path) {
                results.push(res);
            }
        }
    }

    results.sort_by(|a, b| b.volatility.partial_cmp(&a.volatility).unwrap_or(std::cmp::Ordering::Equal));

    let mut rows_html = String::new();
    for item in &results {
        rows_html.push_str(&format!(
            "<tr><td>{}</td><td><strong>{:.1}/10</strong></td><td>{} sections: {}</td></tr>",
            html_escape(&item.filename),
            item.volatility,
            item.num_sections,
            html_escape(&item.breakdown)
        ));
    }

    let html = format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <title>Funscript Volatility Analysis</title>
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
    <h1>Funscript Volatility Analysis ({count} scripts)</h1>
    <table>
        <thead>
            <tr><th>Funscript Name</th><th>Volatility</th><th>Sections Breakdown</th></tr>
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
