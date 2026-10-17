// src/funscript/curve.rs

use crate::funscript::structs::{Action, BpmIntensityPoint};
use crate::funscript::generation::merge_same_position_runs;
use std::cmp::min;

pub const INTENSITY_STEP_MS: u64 = 50;
pub const INTENSITY_WINDOW_MS: u64 = 500;

/// Piecewise-linear BPM-to-intensity calibration table.
pub const BPM_TO_INTENSITY: [(f64, f64); 11] = [
    (0.0, 0.0),
    (42.0, 10.0),
    (66.0, 20.0),
    (90.0, 30.0),
    (116.0, 40.0),
    (140.0, 50.0),
    (160.0, 60.0),
    (182.0, 70.0),
    (218.0, 80.0),
    (245.0, 90.0),
    (270.0, 100.0),
];

/// Inverse mapping table: (intensity_percent, bpm_threshold).
pub const INTENSITY_TO_BPM: [(f64, f64); 11] = [
    (0.0, 0.0),
    (10.0, 42.0),
    (20.0, 66.0),
    (30.0, 90.0),
    (40.0, 116.0),
    (50.0, 140.0),
    (60.0, 160.0),
    (70.0, 182.0),
    (80.0, 218.0),
    (90.0, 245.0),
    (100.0, 270.0),
];

/// Evaluates piecewise-linear interpolation over an `(x, y)` table.
pub fn interpolate_table(table: &[(f64, f64)], x: f64) -> f64 {
    if !x.is_finite() || table.is_empty() || x <= table[0].0 {
        return table.first().map(|p| p.1).unwrap_or(0.0);
    }
    if x >= table.last().unwrap().0 {
        return table.last().unwrap().1;
    }
    for window in table.windows(2) {
        let (x0, y0) = window[0];
        let (x1, y1) = window[1];
        if x <= x1 {
            let dx = x1 - x0;
            if dx.abs() < f64::EPSILON {
                return y1;
            }
            let t = (x - x0) / dx;
            return y0 + (y1 - y0) * t;
        }
    }
    0.0
}

pub fn get_bpm_intensity_mapping() -> Vec<BpmIntensityPoint> {
    BPM_TO_INTENSITY
        .iter()
        .map(|&(bpm, intensity)| BpmIntensityPoint { bpm, intensity })
        .collect()
}

pub fn calculate_intensity_stats(samples: &[Action]) -> (f64, f64) {
    if samples.is_empty() {
        return (0.0, 0.0);
    }

    let peak = samples.iter().map(|a| a.pos).fold(0.0, f64::max);

    if samples.len() == 1 {
        return (samples[0].pos, peak);
    }

    let mut weighted_sum = 0.0;
    let mut total_dt = 0.0;

    for pair in samples.windows(2) {
        let dt = (pair[1].at as f64 - pair[0].at as f64).max(0.0);
        if dt == 0.0 {
            continue;
        }
        let avg_pos = (pair[0].pos + pair[1].pos) / 2.0;
        weighted_sum += avg_pos * dt;
        total_dt += dt;
    }

    if total_dt > 0.0 {
        (weighted_sum / total_dt, peak)
    } else {
        let mean = samples.iter().map(|a| a.pos).sum::<f64>() / samples.len() as f64;
        (mean, peak)
    }
}

fn lerp_position(before: Option<&Action>, after: Option<&Action>, time: u64) -> f64 {
    match (before, after) {
        (Some(b), Some(a)) => {
            if a.at == b.at {
                b.pos
            } else {
                let t = (time as f64 - b.at as f64) / (a.at as f64 - b.at as f64);
                let t = t.clamp(0.0, 1.0);
                b.pos + (a.pos - b.pos) * t
            }
        }
        (Some(b), None) => b.pos,
        (None, Some(a)) => a.pos,
        (None, None) => 0.0,
    }
}

pub fn bpm_to_intensity(bpm: f64) -> f64 {
    interpolate_table(&BPM_TO_INTENSITY, bpm)
}

pub fn intensity_to_bpm(intensity: f64) -> f64 {
    interpolate_table(&INTENSITY_TO_BPM, intensity)
}

pub fn window_intensity(
    actions: &[Action],
    win_start: u64,
    win_end: u64,
    cal_points: &[(f64, f64)],
) -> f64 {
    if actions.is_empty() || win_end <= win_start {
        return 0.0;
    }

    let before_idx = actions.iter().rposition(|a| a.at <= win_start);
    let after_idx = actions.iter().position(|a| a.at >= win_end);

    let mut window_actions: Vec<Action> = Vec::new();

    let start_pos = lerp_position(
        before_idx.map(|i| &actions[i]),
        actions.iter().find(|a| a.at > win_start),
        win_start,
    );
    window_actions.push(Action {
        at: win_start,
        pos: start_pos,
    });

    for action in actions
        .iter()
        .filter(|a| a.at > win_start && a.at < win_end)
    {
        window_actions.push(action.clone());
    }

    let end_pos = lerp_position(
        actions.iter().rev().find(|a| a.at < win_end),
        after_idx.map(|i| &actions[i]),
        win_end,
    );
    window_actions.push(Action {
        at: win_end,
        pos: end_pos,
    });

    let total_change: f64 = window_actions
        .windows(2)
        .map(|pair| (pair[1].pos - pair[0].pos).abs())
        .sum();

    let duration_sec = (win_end - win_start) as f64 / 1000.0;
    if duration_sec <= 0.0 {
        return 0.0;
    }

    let bpm = (total_change / 200.0) * (60.0 / duration_sec);
    let raw_intensity = bpm_to_intensity(bpm);
    get_calibrated_intensity(raw_intensity, cal_points)
}

pub fn actions_to_intensity_curve(actions: &[Action], cal_points: &[(f64, f64)]) -> Vec<Action> {
    let step_ms = INTENSITY_STEP_MS;
    let window_ms = INTENSITY_WINDOW_MS;

    if actions.len() < 2 {
        return Vec::new();
    }

    if !is_binary_script(actions) {
        log::warn!(
            "actions_to_intensity_curve: input is not a binary (0/100) script — \
             found non-binary positions. Returning empty intensity curve."
        );
        return Vec::new();
    }

    let mut sorted = actions.to_vec();
    sorted.sort_by_key(|a| a.at);
    merge_same_position_runs(&mut sorted, 200);

    let end_time = sorted.last().unwrap().at;
    let start_time = sorted.first().unwrap().at;

    const MAX_RISE_PER_SEC: f64 = 40.0;
    const SMOOTHING: f64 = 0.6;
    let max_rise_per_step = MAX_RISE_PER_SEC / 1000.0 * step_ms as f64;

    let mut output = Vec::new();
    if start_time > 0 {
        output.push(Action { at: 0, pos: 0.0 });
    }

    let mut prev_intensity = 0.0;
    let mut prev_smooth = 0.0;
    let mut t: u64 = 0;

    while t <= end_time {
        let w_start = t.saturating_sub(window_ms);
        let w_end = min(end_time, t + window_ms);

        let mut intensity = window_intensity(&sorted, w_start, w_end, cal_points);

        if intensity > prev_intensity + max_rise_per_step {
            intensity = prev_intensity + max_rise_per_step;
        }

        let smoothed = prev_smooth + SMOOTHING * (intensity - prev_smooth);
        let final_val = intensity.max(smoothed);

        let snapped_time = ((t as f64 / step_ms as f64).round() as u64) * step_ms;
        output.push(Action {
            at: snapped_time,
            pos: final_val,
        });

        prev_smooth = smoothed;
        prev_intensity = final_val;
        t += step_ms;
    }

    output
}

fn is_binary_script(actions: &[Action]) -> bool {
    actions.iter().all(|a| {
        let p = a.pos.round() as i64;
        p == 0 || p == 100
    })
}

pub fn get_calibrated_intensity(raw_intensity: f64, cal_points: &[(f64, f64)]) -> f64 {
    if cal_points.len() <= 1 {
        return raw_intensity;
    }

    let bpm = intensity_to_bpm(raw_intensity);
    if bpm <= 0.0 {
        return 0.0;
    }

    if let Some(&(last_bpm, last_intensity)) = cal_points.last() {
        if last_bpm < 270.0 && bpm > last_bpm {
            return interpolate_table(&[(last_bpm, last_intensity), (270.0, 100.0)], bpm);
        }
    }

    interpolate_table(cal_points, bpm)
}
