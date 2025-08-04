// src/buttplug/funscript_utils.rs

//! Funscript processing module
//! 
//! This module handles processing of funscript files which contain synchronized motion
//! data for videos. It provides functionality to:
//! - Parse funscript data structures
//! - Calculate motion intensities
//! - Interpolate between motion points
//! - Optimize motion data for real-time playback

use serde::{
    Deserialize, 
    Serialize
};
use std::cmp::{
    max, 
    min
};

/// Represents a single motion action at a specific timestamp
/// 
/// Actions contain a timestamp (`at`) in milliseconds and a position (`pos`)
/// value between 0.0 and 100.0 representing the motion position.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    /// Timestamp in milliseconds when this action occurs
    #[serde(rename = "at")]
    pub at: u64,
    /// Position value between 0.0 (min) and 100.0 (max)
    #[serde(rename = "pos")]
    pub pos: f64,
}

/// Collection of motion actions forming a complete funscript
///
/// Contains an ordered sequence of actions that define the motion
/// pattern over time.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunscriptData {
    /// Vector of actions in chronological order
    pub actions: Vec<Action>,
}

/// Calculates the interpolated position at a given time between two actions
///
/// Uses linear interpolation to determine the position at any timestamp
/// between two known action points.
///
/// # Arguments
/// * `a0` - The previous action (or None if before first action)
/// * `a1` - The next action (or None if after last action)
/// * `time` - The timestamp to interpolate at
///
/// # Returns
/// * `f64` - The interpolated position value
fn interpolate_position(a0: Option<&Action>, a1: Option<&Action>, time: u64) -> f64 {
    match (a0, a1) {
        (None, None) => 0.0,
        (None, Some(act1)) => act1.pos,
        (Some(act0), None) => act0.pos,
        (Some(act0), Some(act1)) => {
            if time <= act0.at { return act0.pos; }
            if time >= act1.at { return act1.pos; }
            if act0.at == act1.at { return act0.pos; }
            
            let time_fraction = (time - act0.at) as f64 / (act1.at - act0.at) as f64;
            act0.pos + (act1.pos - act0.pos) * time_fraction
        }
    }
}

/// Optimizes action data by combining consecutive identical positions
///
/// Reduces the number of actions by averaging timestamps of consecutive
/// actions with the same position value within a specified time window.
///
/// # Arguments
/// * `actions` - Vector of actions to optimize
/// * `max_gap_ms` - Maximum time gap in milliseconds to consider positions identical
fn condense_identical_positions(actions: &mut Vec<Action>, max_gap_ms: u64) {
    if actions.is_empty() { return; }
    
    let mut condensed = Vec::new();
    let mut group = vec![actions[0].clone()];

    for a in actions.iter().skip(1) {
        if (a.pos == group.last().unwrap().pos) && (a.at - group.last().unwrap().at <= max_gap_ms) {
            group.push(a.clone());
        } else {
            if group.len() > 1 {
                // Average timestamps for grouped actions
                let avg_at = group.iter().map(|x| x.at as u128).sum::<u128>() / group.len() as u128;
                condensed.push(Action { at: avg_at as u64, pos: group[0].pos });
            } else {
                condensed.push(group[0].clone());
            }
            group = vec![a.clone()];
        }
    }

    // Handle the last group
    if group.len() > 1 {
        let avg_at = group.iter().map(|x| x.at as u128).sum::<u128>() / group.len() as u128;
        condensed.push(Action { at: avg_at as u64, pos: group[0].pos });
    } else {
        condensed.push(group[0].clone());
    }

    *actions = condensed;
}

/// Calculates continuous intensity values from discrete motion actions
///
/// Processes raw motion data to generate a continuous intensity curve that
/// represents the speed and amplitude of movements. The intensity is scaled
/// so that 4 full thrusts per second corresponds to an intensity value of 100.
///
/// # Arguments
/// * `actions` - Slice of motion actions to process
/// * `sample_rate_ms` - How often to sample the intensity (milliseconds)
/// * `window_radius_ms` - Size of the moving analysis window (milliseconds)
///
/// # Returns
/// * `Vec<Action>` - Vector of actions containing calculated intensities
pub fn calculate_thrust_intensity_by_scaled_speed(
    actions: &mut [Action],
    sample_rate_ms: u64,
    window_radius_ms: u64,
) -> Vec<Action> {
    if actions.len() < 2 { return Vec::new(); }

    // Validate input positions
    if let Some(invalid_action) = actions.iter().find(|a| a.pos != 0.0 && a.pos != 100.0) {
        eprintln!(
            "Error: Invalid position value {} at time {}ms. Valid values are 0 or 100.",
            invalid_action.pos,
            invalid_action.at
        );
        return Vec::new();
    }

    // Initialize processing
    actions.sort_by_key(|a| a.at);
    let mut actions_vec = actions.to_vec();
    condense_identical_positions(&mut actions_vec, 200);

    let mut output_actions = Vec::new();
    let min_time = actions.first().unwrap().at;
    let max_time = actions.last().unwrap().at;

    // Configuration constants
    const SCALING_FACTOR: f64 = 125.0;        // Speed(%/ms) * 125
    const MAX_INCREASE_PER_SEC: f64 = 40.0;   // Maximum intensity increase per second
    const SLOW_ALPHA: f64 = 0.6;              // Smoothing factor
    let max_increase_per_ms = MAX_INCREASE_PER_SEC / 1000.0;

    // Add initial zero point if needed
    if min_time > 0 {
        output_actions.push(Action { at: 0, pos: 0.0 });
    }

    // Processing state
    let mut t = 0;
    let mut previous_intensity = 0.0;
    let mut previous_smooth = 0.0;

    // Main processing loop
    while t <= max_time {
        let window_start = max(0, t.saturating_sub(window_radius_ms));
        let window_end = min(max_time, t + window_radius_ms);
        let window_duration_ms = window_end.saturating_sub(window_start);

        // Calculate raw intensity within window
        let mut raw_intensity = if window_duration_ms > 0 {
            calculate_window_intensity(
                actions, 
                window_start, 
                window_end, 
                window_duration_ms,
                SCALING_FACTOR
            )
        } else {
            0.0
        };

        // Apply rate limiting
        if sample_rate_ms > 0 {
            let max_inc = max_increase_per_ms * sample_rate_ms as f64;
            if raw_intensity > previous_intensity + max_inc {
                raw_intensity = previous_intensity + max_inc;
            }
        }

        // Apply smoothing and create output action
        let rounded_time = ((t as f64 / sample_rate_ms as f64).round() as u64) * sample_rate_ms;
        let smooth_intensity = previous_smooth + SLOW_ALPHA * (raw_intensity - previous_smooth);
        let final_intensity = raw_intensity.max(smooth_intensity);

        output_actions.push(Action { at: rounded_time, pos: final_intensity });

        // Update state
        previous_smooth = smooth_intensity;
        previous_intensity = final_intensity;
        t += sample_rate_ms;
        if sample_rate_ms == 0 { break; }
    }

    output_actions
}

/// Helper function to calculate intensity within a time window
fn calculate_window_intensity(
    actions: &[Action],
    window_start: u64,
    window_end: u64,
    window_duration_ms: u64,
    scaling_factor: f64,
) -> f64 {
    // Find boundary actions
    let start_idx = actions.iter()
        .rposition(|a| a.at <= window_start)
        .unwrap_or(0);
    let start_action = &actions[start_idx];
    let end_idx = actions.iter()
        .position(|a| a.at >= window_end)
        .unwrap_or(actions.len() - 1);
    let end_action = &actions[end_idx];

    // Build points list with interpolated boundaries
    let mut pts = Vec::new();
    pts.push(Action {
        at: window_start,
        pos: interpolate_position(Some(start_action), actions.get(start_idx + 1), window_start)
    });

    // Add intermediate points
    pts.extend(actions.iter()
        .filter(|a| a.at > window_start && a.at < window_end)
        .cloned());

    // Add end point
    let prev_for_end = actions[..end_idx].iter().rev()
        .find(|a| a.at < window_end)
        .or(Some(start_action));
    pts.push(Action {
        at: window_end,
        pos: interpolate_position(prev_for_end, Some(end_action), window_end)
    });

    // Calculate intensity
    let raw_intensity = pts.windows(2)
        .filter(|w| w[1].at > w[0].at)
        .map(|w| (w[1].pos - w[0].pos).abs())
        .sum::<f64>();

    let intensity = (raw_intensity / window_duration_ms as f64) * scaling_factor;
    if intensity.is_finite() { intensity } else { 0.0 }
}