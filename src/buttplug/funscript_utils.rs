// src/buttplug/funscript_utils.rs

//! Funscript processing module
//!
//! This module handles processing of funscript files which contain synchronized motion
//! data for videos. It provides utilities to:
//! - Parse funscript data structures
//! - Calculate motion intensities from discrete action sets
//! - Interpolate between motion points
//! - Optimize motion data for real-time playback
//!
//! Conventions and units:
//! - Time is expressed in milliseconds (u64).
//! - Position values are floating point in the range 0.0 .. 100.0.
//! - Many helpers assume the input funscript uses "binary" extremes (0 or 100) when
//!   deriving speed-based intensity. Functions validate and document when this is required.
//! - Intensity values returned by processing functions are in the same 0.0 .. 100.0 range.

use serde::{Deserialize, Serialize};
use std::cmp::min;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    #[serde(rename = "at")]
    pub at: u64,
    #[serde(rename = "pos")]
    pub pos: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunscriptData {
    pub actions: Vec<Action>,
    #[serde(default = "default_version")]
    pub version: String,
    #[serde(default)]
    pub inverted: bool,
    #[serde(default = "default_range")]
    pub range: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
}

fn default_version() -> String {
    "1.0".into()
}
fn default_range() -> u32 {
    100
}

impl Default for FunscriptData {
    fn default() -> Self {
        Self {
            actions: Vec::new(),
            version: default_version(),
            inverted: false,
            range: default_range(),
            metadata: None,
        }
    }
}

/// Piecewise-linear BPM-to-intensity calibration table.
/// Each entry is (bpm_threshold, intensity_percent).
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

#[derive(Debug, Clone, Serialize)]
pub struct BpmIntensityPoint {
    pub bpm: f64,
    pub intensity: f64,
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

/// Linearly interpolate position between two actions at a given time.
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

/// Merge runs of same-position actions within `max_gap_ms` into one action
/// at the averaged timestamp.
fn merge_same_position_runs(actions: &mut Vec<Action>, max_gap_ms: u64) {
    if actions.is_empty() {
        return;
    }

    let mut result = Vec::new();
    let mut run_start = 0;

    for i in 1..=actions.len() {
        let end_of_run = i == actions.len()
            || actions[i].pos != actions[run_start].pos
            || actions[i].at - actions[i - 1].at > max_gap_ms;

        if end_of_run {
            let run = &actions[run_start..i];
            let avg_time = run.iter().map(|a| a.at as u128).sum::<u128>() / run.len() as u128;
            result.push(Action {
                at: avg_time as u64,
                pos: run[0].pos,
            });
            run_start = i;
        }
    }
    *actions = result;
}

/// Piecewise-linear lookup: BPM → intensity (0..100). Clamps to table bounds.
fn bpm_to_intensity(bpm: f64) -> f64 {
    if !bpm.is_finite() || bpm <= 0.0 {
        return 0.0;
    }

    let table = &BPM_TO_INTENSITY;
    if bpm >= table.last().unwrap().0 {
        return table.last().unwrap().1;
    }

    for pair in table.windows(2) {
        let (b0, i0) = pair[0];
        let (b1, i1) = pair[1];
        if bpm <= b1 {
            let t = (bpm - b0) / (b1 - b0);
            return i0 + (i1 - i0) * t;
        }
    }
    0.0
}

/// Sum absolute position changes within [win_start, win_end], convert to BPM,
/// then map to intensity. Inserts interpolated boundary points.
fn window_intensity(actions: &[Action], win_start: u64, win_end: u64) -> f64 {
    if actions.is_empty() || win_end <= win_start {
        return 0.0;
    }

    // Find the index range of actions that fall within or straddle the window.
    // before_idx: last action at or before win_start
    // after_idx:  first action at or after win_end
    let before_idx = actions.iter().rposition(|a| a.at <= win_start);
    let after_idx = actions.iter().position(|a| a.at >= win_end);

    // Build a small working list with interpolated boundary points.
    let mut window_actions: Vec<Action> = Vec::new();

    // Interpolated start-boundary point
    let start_pos = lerp_position(
        before_idx.map(|i| &actions[i]),
        actions.iter().find(|a| a.at > win_start),
        win_start,
    );
    window_actions.push(Action {
        at: win_start,
        pos: start_pos,
    });

    // All actions strictly inside the window
    for action in actions
        .iter()
        .filter(|a| a.at > win_start && a.at < win_end)
    {
        window_actions.push(action.clone());
    }

    // Interpolated end-boundary point
    let end_pos = lerp_position(
        actions.iter().rev().find(|a| a.at < win_end),
        after_idx.map(|i| &actions[i]),
        win_end,
    );
    window_actions.push(Action {
        at: win_end,
        pos: end_pos,
    });

    // Total absolute position change across the window
    let total_change: f64 = window_actions
        .windows(2)
        .map(|pair| (pair[1].pos - pair[0].pos).abs())
        .sum();

    let duration_sec = (win_end - win_start) as f64 / 1000.0;
    if duration_sec <= 0.0 {
        return 0.0;
    }

    // Each full 0→100→0 stroke is 200 position-units and equals one "beat".
    // BPM = (total_change / 200) / (duration_sec / 60)
    //     = total_change * 60 / (200 * duration_sec)
    //     = total_change * 300.0 / (1000.0 * duration_sec)   [when duration is in ms]
    let bpm = (total_change / 200.0) * (60.0 / duration_sec);
    bpm_to_intensity(bpm)
}

/// Convert binary (0/100) funscript actions into a smoothed intensity curve.
///
/// Returns evenly-spaced actions where `pos` represents intensity (0..100).
///
/// Returns an empty `Vec` if the input is not a binary script (positions must
/// be 0 or 100) or contains fewer than 2 actions.
pub fn actions_to_intensity_curve(actions: &[Action], step_ms: u64, window_ms: u64) -> Vec<Action> {
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

        let mut intensity = window_intensity(&sorted, w_start, w_end);

        // Rate-limit rises
        if intensity > prev_intensity + max_rise_per_step {
            intensity = prev_intensity + max_rise_per_step;
        }

        // Exponential smoothing (only prevents sharp drops)
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

/// Only funscripts that contain pos values of either 0 or 100 are allowed.
fn is_binary_script(actions: &[Action]) -> bool {
    actions.iter().all(|a| {
        let p = a.pos.round() as i64;
        p == 0 || p == 100
    })
}

pub fn double_time_actions(actions: &[Action]) -> Vec<Action> {
    if actions.len() < 2 {
        return actions.to_vec();
    }

    let mut result = Vec::with_capacity(actions.len() * 2);

    // bisect every interval, effectively doubling the action count locally.
    for i in 0..actions.len() - 1 {
        let a = &actions[i];
        let b = &actions[i + 1];
        let start_pos_idx = i & !1;
        let mid_pos_idx = i | 1;

        // Original interval
        result.push(Action {
            at: a.at,
            pos: actions[start_pos_idx].pos,
        });

        // Inserted intermediate thrust
        result.push(Action {
            at: a.at + b.at.saturating_sub(a.at) / 2,
            pos: actions[mid_pos_idx].pos,
        });
    }

    let last_idx = actions.len() - 1;
    result.push(Action {
        at: actions[last_idx].at,
        pos: actions[last_idx & !1].pos,
    });

    merge_same_position_runs(&mut result, 2);

    result
}

pub fn half_time_actions(actions: &[Action]) -> Vec<Action> {
    if actions.len() < 2 {
        return actions.to_vec();
    }

    let mut result = Vec::with_capacity(actions.len() / 2 + 2);
    let mut pos_idx = 0;

    // Take every 2nd timestamp, but assign them the sequential positions.
    // This halves the frequency but keeps the beats perfectly anchored to the video.
    for i in (0..actions.len()).step_by(2) {
        if pos_idx < actions.len() {
            result.push(Action {
                at: actions[i].at,
                pos: actions[pos_idx].pos,
            });
            pos_idx += 1;
        }
    }

    let end_time = actions.last().unwrap().at;
    if let Some(last) = result.last().cloned() {
        if last.at < end_time {
            result.push(Action {
                at: end_time,
                pos: last.pos,
            });
        }
    }

    merge_same_position_runs(&mut result, 2);

    result
}
