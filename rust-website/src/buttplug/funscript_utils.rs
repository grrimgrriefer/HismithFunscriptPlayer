// src/funscript_utils.rs

use serde::{Deserialize, Serialize};
use std::cmp::{max, min};

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
    // #[serde(default)]
    // pub metadata: Option<serde_json::Value>,
}

// --- Helper Function: Interpolate Position ---
/// Calculates the position at a specific time between two actions using linear interpolation.
///
/// # Arguments
/// * `a0` - An Option containing the action before the target time.
/// * `a1` - An Option containing the action after the target time.
/// * `time` - The target time in milliseconds.
///
/// # Returns
/// The interpolated position (0.0-100.0).
fn interpolate_position(a0: Option<&Action>, a1: Option<&Action>, time: u64) -> f64 {
    match (a0, a1) {
        (None, None) => 0.0,
        (None, Some(act1)) => act1.pos,
        (Some(act0), None) => act0.pos,
        (Some(act0), Some(act1)) => {
            if time <= act0.at {
                return act0.pos;
            }
            if time >= act1.at {
                return act1.pos;
            }
            if act0.at == act1.at {
                return act0.pos;
            }
            let time_fraction = (time - act0.at) as f64 / (act1.at - act0.at) as f64;
            act0.pos + (act1.pos - act0.pos) * time_fraction
        }
    }
}


// --- Main Function: Calculate Thrust Intensity ---
/// Calculates thrust intensity based on the total absolute position change
/// within a moving window, scaled so that 4 full thrusts/sec corresponds to an
/// intensity value of 100. Applies a rate limit to the intensity increase.
/// Outputs the raw calculated value without clamping or rounding.
///
/// # Arguments
/// * `actions` - A mutable slice of input actions {at, pos}. It will be sorted in place.
/// * `sample_rate_ms` - The interval for output samples (e.g., 50ms).
/// * `window_radius_ms` - The radius of the moving window (e.g., 200ms for a 400ms total window).
///
/// # Returns
/// A new vector of actions {at, pos} where pos is the raw calculated thrust intensity with rate limiting applied.
pub fn calculate_thrust_intensity_by_scaled_speed(
    actions: &mut [Action],
    sample_rate_ms: u64,
    window_radius_ms: u64,
) -> Vec<Action> {
    if actions.len() < 2 {
        return Vec::new();
    }

    if let Some(invalid_action) = actions.iter().find(|a| a.pos != 0.0 && a.pos != 100.0) {
        eprintln!("Error: Invalid position value {} at time {}ms. Valid values are 0 or 100.", 
                 invalid_action.pos, invalid_action.at);
        return Vec::new();
    }

    // Sort actions by time - modifies the input slice
    actions.sort_by_key(|a| a.at);

    let mut output_actions = Vec::new();
    let min_time = actions.first().unwrap().at;
    let max_time = actions.last().unwrap().at;

    // Scaling factor: Speed(%/ms) * 125
    const SCALING_FACTOR: f64 = 125.0;
    // Rate limiting: Max increase of 40 units per second
    const MAX_INCREASE_PER_SEC: f64 = 40.0;
    let max_increase_per_ms = MAX_INCREASE_PER_SEC / 1000.0;

    // Add an initial point at t=0 if needed
    if min_time > 0 {
        output_actions.push(Action { at: 0, pos: 0.0 });
    }

    let mut t = 0;
    let mut previous_intensity = 0.0; // Track previous intensity for rate limiting

    while t <= max_time {
        let window_start = max(0, t.saturating_sub(window_radius_ms));
        let window_end = min(max_time, t + window_radius_ms);
        let window_duration_ms = window_end.saturating_sub(window_start);

        let mut raw_intensity = 0.0; // Initialize intensity for this sample

        if window_duration_ms > 0 {
            // --- Find boundary actions ---
            let start_boundary_action_index = actions
                .iter()
                .rposition(|a| a.at <= window_start)
                .unwrap_or(0);
            let start_boundary_action = &actions[start_boundary_action_index];

            let end_boundary_action_index = actions
                .iter()
                .position(|a| a.at >= window_end)
                .unwrap_or(actions.len() - 1);
            let end_boundary_action = &actions[end_boundary_action_index];


            // --- Create list of points relevant to the window's change calculation ---
            let mut effective_points = Vec::new();

            // Interpolate position at the exact start of the window
            let prev_action_for_start = Some(start_boundary_action);
            // Use .get() for safe access to the next action
            let next_action_for_start = actions.get(start_boundary_action_index + 1);
            let position_at_window_start = interpolate_position(
                prev_action_for_start,
                next_action_for_start,
                window_start,
            );
            effective_points.push(Action { at: window_start, pos: position_at_window_start });


            // Add all original actions strictly within the window interval
            actions.iter().for_each(|a| {
                if a.at > window_start && a.at < window_end {
                    effective_points.push(a.clone());
                }
            });

            // Interpolate position at the exact end of the window
            let prev_action_for_end = actions[..end_boundary_action_index]
                                       .iter()
                                       .rev()
                                       .find(|a| a.at < window_end)
                                       .or(Some(start_boundary_action));

            let next_action_for_end = Some(end_boundary_action);
            let position_at_window_end = interpolate_position(
                prev_action_for_end,
                next_action_for_end,
                window_end,
            );
             effective_points.push(Action { at: window_end, pos: position_at_window_end });

            // Sort effective points
            effective_points.sort_by_key(|a| a.at);

            // Calculate sum of absolute differences
            let mut total_position_change = 0.0;
             for window in effective_points.windows(2) {
                 let p1 = &window[0];
                 let p2 = &window[1];
                 if p2.at > p1.at {
                     total_position_change += (p2.pos - p1.pos).abs();
                 }
             }

            // Calculate raw intensity
            raw_intensity = (total_position_change / window_duration_ms as f64) * SCALING_FACTOR;

            // Handle potential NaN/Infinity
             if !raw_intensity.is_finite() {
                 raw_intensity = 0.0;
             }
        } // End of if window_duration_ms > 0

        // ---> START: Apply Rate Limiting <---
        if sample_rate_ms > 0 {
            let max_increase_this_step = max_increase_per_ms * sample_rate_ms as f64;
            if raw_intensity > previous_intensity + max_increase_this_step {
                raw_intensity = previous_intensity + max_increase_this_step;
            }
        }
        // ---> END: Apply Rate Limiting <---

        // Round time to the nearest sample rate interval
        let rounded_time = ((t as f64 / sample_rate_ms as f64).round() as u64) * sample_rate_ms;

        // Check if the last added action has the same timestamp; if so, update pos.
        if let Some(last_action) = output_actions.last_mut() {
            if last_action.at == rounded_time {
                last_action.pos = raw_intensity;
                // ---> Update previous intensity AFTER potential update <---
                previous_intensity = raw_intensity;
                 t += sample_rate_ms;
                 continue; // Skip pushing a new one
            }
        }

        // Push the new action if no existing action at rounded_time
        output_actions.push(Action { at: rounded_time, pos: raw_intensity });

        // ---> Update previous intensity AFTER pushing new action <---
        previous_intensity = raw_intensity;

        // Increment time for the next sample
        t += sample_rate_ms;
        // Ensure we don't get stuck if sample_rate_ms is 0
        if sample_rate_ms == 0 {
             break; // Prevent infinite loop
        }
    } // End of while loop

    output_actions
}