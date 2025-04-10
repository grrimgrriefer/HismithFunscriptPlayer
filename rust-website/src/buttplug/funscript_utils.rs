// src/funscript_utils.rs

use serde::{Deserialize, Serialize}; // <-- Add this
use std::cmp::{max, min};

// Add Serialize and Deserialize
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Action {
    #[serde(rename = "at")] // Map JSON 'at' to Rust 'at'
    pub at: u64,
    #[serde(rename = "pos")] // Map JSON 'pos' to Rust 'pos'
    pub pos: f64,
}

// Wrapper struct to match typical .funscript JSON format
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FunscriptData {
    pub actions: Vec<Action>,
    // Add other fields if your .funscript files have them (e.g., metadata)
    // #[serde(default)] // Use if fields are optional
    // pub metadata: Option<serde_json::Value>,
}


// --- Helper Function: Interpolate Position ---
// (Keep the interpolate_position function exactly as before)
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
        // Handle edge cases or invalid input
        (None, None) => 0.0, // No actions provided
        (None, Some(act1)) => act1.pos, // Only action after exists
        (Some(act0), None) => act0.pos, // Only action before exists
        (Some(act0), Some(act1)) => {
            if time <= act0.at {
                return act0.pos;
            }
            if time >= act1.at {
                return act1.pos;
            }
            if act0.at == act1.at {
                // Avoid division by zero if times are identical
                return act0.pos;
            }

            // Linear interpolation
            let time_fraction = (time - act0.at) as f64 / (act1.at - act0.at) as f64;
            act0.pos + (act1.pos - act0.pos) * time_fraction
        }
    }
}


// --- Main Function: Calculate Thrust Intensity ---
// (Keep the calculate_thrust_intensity_by_scaled_speed function exactly as before)
/// Calculates thrust intensity based on the total absolute position change
/// within a moving window, scaled so that 4 full thrusts/sec corresponds to an
/// intensity value of 100. Outputs the raw calculated value without clamping or rounding.
///
/// # Arguments
/// * `actions` - A mutable slice of input actions {at, pos}. It will be sorted in place.
/// * `sample_rate_ms` - The interval for output samples (e.g., 50ms).
/// * `window_radius_ms` - The radius of the moving window (e.g., 200ms for a 400ms total window).
///
/// # Returns
/// A new vector of actions {at, pos} where pos is the raw calculated thrust intensity.
pub fn calculate_thrust_intensity_by_scaled_speed(
    actions: &mut [Action], // Take mutable slice to allow in-place sorting
    sample_rate_ms: u64,
    window_radius_ms: u64,
) -> Vec<Action> {
    if actions.len() < 2 {
        return Vec::new(); // Return empty vector if not enough actions
    }

    // Sort actions by time - modifies the input slice
    actions.sort_by_key(|a| a.at);

    let mut output_actions = Vec::new();
    // Safe to unwrap because we checked length >= 2
    let min_time = actions.first().unwrap().at;
    let max_time = actions.last().unwrap().at;

    // Scaling factor derived from: 4 thrusts/sec = 100 intensity
    // Intensity = (Speed(%/ms) * 1000 / 800) * 100 = Speed(%/ms) * 125
    const SCALING_FACTOR: f64 = 125.0;

    // Add an initial point at t=0 if the script doesn't start exactly at 0
    if min_time > 0 {
        output_actions.push(Action { at: 0, pos: 0.0 });
    }

    let mut t = 0;
    while t <= max_time {
        let window_start = max(0, t.saturating_sub(window_radius_ms)); // Prevent underflow
        let window_end = min(max_time, t + window_radius_ms);
        let window_duration_ms = window_end.saturating_sub(window_start);

        let mut raw_intensity = 0.0; // Initialize intensity for this sample

        if window_duration_ms > 0 {
            // Find the last action *before* or *at* windowStart
            // Use rposition to find the index from the end efficiently
            let start_boundary_action_index = actions
                .iter()
                .rposition(|a| a.at <= window_start)
                .unwrap_or(0); // Default to the first action if none found before/at start
            let start_boundary_action = &actions[start_boundary_action_index];

            // Find the first action *after* or *at* windowEnd
            // Use position to find the index from the beginning efficiently
            let end_boundary_action_index = actions
                .iter()
                .position(|a| a.at >= window_end)
                .unwrap_or(actions.len() - 1); // Default to the last action if none found after/at end
            let end_boundary_action = &actions[end_boundary_action_index];


            // --- Create list of points relevant to the window's change calculation ---
            let mut effective_points = Vec::new();

            // Interpolate position at the exact start of the window
            let prev_action_for_start = Some(start_boundary_action);
            // Find the next action *strictly after* the start_boundary_action for interpolation
            let next_action_for_start = actions[start_boundary_action_index + 1..]
                                           .iter()
                                           .find(|a| a.at > start_boundary_action.at); // Check if index is valid? Handled by slice range
            let position_at_window_start = interpolate_position(
                prev_action_for_start,
                next_action_for_start,
                window_start,
            );
            effective_points.push(Action { at: window_start, pos: position_at_window_start });


            // Add all original actions strictly within the window interval
            actions.iter().for_each(|a| {
                if a.at > window_start && a.at < window_end {
                    // Clone the action to push into effective_points
                    effective_points.push(a.clone());
                }
            });

            // Interpolate position at the exact end of the window
            // Find the action strictly *before* window_end for interpolation
            let prev_action_for_end = actions[..end_boundary_action_index] // Search only before the end_boundary_action
                                       .iter()
                                       .rev()
                                       .find(|a| a.at < window_end)
                                       .or(Some(start_boundary_action)); // Fallback if nothing before window_end is found

            let next_action_for_end = Some(end_boundary_action);
            let position_at_window_end = interpolate_position(
                prev_action_for_end,
                next_action_for_end,
                window_end,
            );
             effective_points.push(Action { at: window_end, pos: position_at_window_end });

            // Sort effective points by time just in case interpolation points got out of order
            // (Shouldn't happen with this logic, but safe practice)
            effective_points.sort_by_key(|a| a.at);

            // Calculate sum of absolute differences between consecutive effective points
            let mut total_position_change = 0.0;
             for window in effective_points.windows(2) {
                 let p1 = &window[0];
                 let p2 = &window[1];
                 // Ensure time actually progresses to avoid division by zero later if needed,
                 // and only count change where time moves forward.
                 if p2.at > p1.at {
                     total_position_change += (p2.pos - p1.pos).abs();
                 }
             }

            // Calculate intensity using the derived scaling factor
            raw_intensity = (total_position_change / window_duration_ms as f64) * SCALING_FACTOR;

            // Handle potential NaN/Infinity if windowDurationMs was somehow zero despite check
             if !raw_intensity.is_finite() {
                 raw_intensity = 0.0;
             }
        }

        // Round time to the nearest sample rate interval
        // Use floating point division for accuracy before rounding
        let rounded_time = ((t as f64 / sample_rate_ms as f64).round() as u64) * sample_rate_ms;

        // Check if the last added action has the same timestamp; if so, update pos. Otherwise, push new.
        if let Some(last_action) = output_actions.last_mut() {
            if last_action.at == rounded_time {
                // Update position of the existing action at this rounded time
                last_action.pos = raw_intensity;
                 // Skip pushing a new one and proceed to next t
                 t += sample_rate_ms;
                 continue;
            }
        }

        // Push the new action if no existing action at rounded_time
        output_actions.push(Action { at: rounded_time, pos: raw_intensity });


        // Increment time for the next sample
        t += sample_rate_ms;
        // Ensure we don't get stuck if sample_rate_ms is 0 (though it shouldn't be)
        if sample_rate_ms == 0 {
             break; // Prevent infinite loop
        }
    }

    output_actions
}

// --- Add Tests if desired ---
#[cfg(test)]
mod tests {
   // (Include the tests from the previous response if you want them here)
}