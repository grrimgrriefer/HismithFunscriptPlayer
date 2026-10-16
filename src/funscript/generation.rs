// src/funscript/generation.rs

use crate::funscript::structs::Action;
use std::collections::BTreeMap;

/// Generate full funscript actions from raw tap timestamps (ms).
/// Inserts down-thrusts halfway between taps, edge padding, and deduplicates identical timestamps.
pub fn generate_funscript_actions_from_taps(taps: &[u64]) -> Vec<Action> {
    if taps.is_empty() {
        return vec![Action { at: 0, pos: 0.0 }];
    }

    let mut sorted_taps = taps.to_vec();
    sorted_taps.sort_unstable();
    sorted_taps.dedup();

    let mut actions = Vec::new();
    let mut last = 0u64;

    for &t in &sorted_taps {
        let down = (last + t) / 2;
        if !actions.is_empty() || down > 0 {
            actions.push(Action { at: down, pos: 0.0 });
        }
        actions.push(Action { at: t, pos: 100.0 });
        last = t;
    }

    actions.push(Action { at: last + 500, pos: 0.0 });
    if actions.first().map_or(false, |a| a.at > 0) {
        actions.insert(0, Action { at: 0, pos: 0.0 });
    }

    let mut seen = BTreeMap::new();
    for action in actions {
        seen.insert(action.at, action);
    }
    seen.into_values().collect()
}

/// Merge runs of same-position actions within `max_gap_ms` into one action at the averaged timestamp.
pub fn merge_same_position_runs(actions: &mut Vec<Action>, max_gap_ms: u64) {
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

pub fn double_beat_actions(actions: &[Action]) -> Vec<Action> {
    if actions.len() < 2 {
        return actions.to_vec();
    }

    let mut result = Vec::with_capacity(actions.len() * 2);

    for i in 0..actions.len() - 1 {
        let a = &actions[i];
        let b = &actions[i + 1];
        let start_pos_idx = i & !1;
        let mid_pos_idx = i | 1;

        result.push(Action {
            at: a.at,
            pos: actions[start_pos_idx].pos,
        });

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

/// Subsamples funscript actions by taking every `step`-th timestamp while assigning sequential position values.
pub fn subsample_beat_actions(actions: &[Action], step: usize) -> Vec<Action> {
    if actions.len() < 2 || step <= 1 {
        return actions.to_vec();
    }

    let mut result = Vec::with_capacity(actions.len() / step + 2);
    let mut pos_idx = 0;

    for i in (0..actions.len()).step_by(step) {
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

pub fn half_beat_actions(actions: &[Action]) -> Vec<Action> {
    subsample_beat_actions(actions, 2)
}

pub fn quarter_beat_actions(actions: &[Action]) -> Vec<Action> {
    subsample_beat_actions(actions, 4)
}
