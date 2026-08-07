#!/usr/bin/env python3
import os
import sys
import json
from collections import Counter
import math

# BPM to intensity lookup table (matches funscript_utils / calibration)
BPM_TO_INTENSITY = [
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
]

# Constants for intensity curve generation (matching Rust funscript_utils)
INTENSITY_STEP_MS = 50
INTENSITY_WINDOW_MS = 500
MAX_RISE_PER_SEC = 40.0
SMOOTHING = 0.6
MERGE_SAME_POS_GAP_MS = 200

# Constants for section detection sensitivity
MAX_INTENSITY_VARIATION_IN_SECTION = 10.0 
MIN_SECTION_DURATION_SEC = 1.0 

class Action:
    def __init__(self, at, pos):
        self.at = at
        self.pos = pos

    def __repr__(self):
        return f"Action(at={self.at}, pos={self.pos})"

def bpm_to_intensity(bpm):
    if not math.isfinite(bpm) or bpm <= 0.0:
        return 0.0
    if bpm >= BPM_TO_INTENSITY[-1][0]:
        return BPM_TO_INTENSITY[-1][1]

    for i in range(len(BPM_TO_INTENSITY) - 1):
        b0, i0 = BPM_TO_INTENSITY[i]
        b1, i1 = BPM_TO_INTENSITY[i + 1]
        if b0 <= bpm <= b1:
            t = (bpm - b0) / (b1 - b0)
            return i0 + (i1 - i0) * t
    return 0.0

def lerp_position(before, after, time):
    if before is not None and after is not None:
        if after.at == before.at:
            return before.pos
        t = (time - before.at) / (after.at - before.at)
        t = max(0.0, min(1.0, t))
        return before.pos + (after.pos - before.pos) * t
    elif before is not None:
        return before.pos
    elif after is not None:
        return after.pos
    else:
        return 0.0

def merge_same_position_runs(actions_list, max_gap_ms):
    if not actions_list:
        return []

    result = []
    run_start_idx = 0

    for i in range(1, len(actions_list) + 1):
        end_of_run = (i == len(actions_list) or 
                      actions_list[i].pos != actions_list[run_start_idx].pos or
                      actions_list[i].at - actions_list[i-1].at > max_gap_ms)
        
        if end_of_run:
            run = actions_list[run_start_idx:i]
            avg_at = sum(a.at for a in run) // len(run)
            result.append(Action(at=avg_at, pos=run[0].pos))
            run_start_idx = i
            
    return result

def is_binary_script(actions_list):
    # Matches Rust's: let p = a.pos.round() as i64; p == 0 || p == 100
    return all(round(a.pos) == 0 or round(a.pos) == 100 for a in actions_list)

def window_intensity(actions_list, win_start, win_end):
    if not actions_list or win_end <= win_start:
        return 0.0

    before_idx = -1
    for i in range(len(actions_list) - 1, -1, -1):
        if actions_list[i].at <= win_start:
            before_idx = i
            break
    
    after_idx = -1
    for i in range(len(actions_list)):
        if actions_list[i].at >= win_end:
            after_idx = i
            break

    window_actions = []

    # Interpolated start point (strictly matches Rust's .find(|a| a.at > win_start))
    first_after_start = next((a for a in actions_list if a.at > win_start), None)
    start_pos = lerp_position(
        actions_list[before_idx] if before_idx != -1 else None,
        first_after_start,
        win_start
    )
    window_actions.append(Action(at=win_start, pos=start_pos))

    # Strict inside actions
    for a in actions_list:
        if win_start < a.at < win_end:
            window_actions.append(a)

    # Interpolated end point (strictly matches Rust's .rev().find(|a| a.at < win_end))
    last_before_end = next((a for a in reversed(actions_list) if a.at < win_end), None)
    end_pos = lerp_position(
        last_before_end,
        actions_list[after_idx] if after_idx != -1 else None,
        win_end
    )
    window_actions.append(Action(at=win_end, pos=end_pos))

    total_change = sum(abs(window_actions[i+1].pos - window_actions[i].pos) for i in range(len(window_actions) - 1))
    duration_sec = (win_end - win_start) / 1000.0
    
    if duration_sec <= 0.0:
        return 0.0

    bpm = (total_change / 200.0) * (60.0 / duration_sec)
    return bpm_to_intensity(bpm)


def calculate_intensity_curve(raw_actions):
    if not raw_actions or len(raw_actions) < 2:
        return []

    actions_list = [Action(at=a['at'], pos=a['pos']) for a in raw_actions]
    actions_list.sort(key=lambda a: a.at)

    if not is_binary_script(actions_list):
        sys.stderr.write(f"Warning: Script is not binary (0/100 positions). Skipping intensity calculation.\n")
        return []
        
    merged_actions = merge_same_position_runs(actions_list, MERGE_SAME_POS_GAP_MS)
    if not merged_actions:
        return []

    start_time_ms = merged_actions[0].at
    end_time_ms = merged_actions[-1].at

    max_rise_per_step = MAX_RISE_PER_SEC / 1000.0 * INTENSITY_STEP_MS

    output_curve = []
    prev_intensity = 0.0
    prev_smooth = 0.0
    
    if start_time_ms > 0:
        output_curve.append((0, 0.0))

    t_ms = 0
    # Fixed to exactly match Rust bounds
    while t_ms <= end_time_ms: 
        w_start_ms = max(0, t_ms - INTENSITY_WINDOW_MS)
        w_end_ms = min(end_time_ms, t_ms + INTENSITY_WINDOW_MS) 
        
        intensity = window_intensity(merged_actions, w_start_ms, w_end_ms)

        if intensity > prev_intensity + max_rise_per_step:
            intensity = prev_intensity + max_rise_per_step
        
        smoothed = prev_smooth + SMOOTHING * (intensity - prev_smooth)
        final_val = max(intensity, smoothed) 

        snapped_time = round(t_ms / INTENSITY_STEP_MS) * INTENSITY_STEP_MS
        output_curve.append((snapped_time / 1000.0, final_val))
        
        prev_smooth = smoothed
        prev_intensity = final_val
        t_ms += INTENSITY_STEP_MS

    return output_curve

def get_bucket(intensity):
    val = max(0.0, min(100.0, intensity))
    lower = int(val // 10) * 10
    if lower == 100: 
        lower = 90
    return f"{lower}-{lower+10}"

def calculate_std_dev(data):
    if not data:
        return 0.0
    n = len(data)
    mean = sum(data) / n
    variance = sum((x - mean) ** 2 for x in data) / n
    return math.sqrt(variance)

def compute_sections(curve):
    """Refined section grouping. Uses Peak for buckets and merges seamlessly."""
    sections = []
    if not curve:
        return []
        
    current_start_idx = 0
    i = 0
    
    # 1. First pass: Split logically on sustained variation limits
    while i < len(curve):
        window = curve[current_start_idx:i+1]
        window_intensities = [p[1] for p in window]
        c_min = min(window_intensities)
        c_max = max(window_intensities)
        
        if c_max - c_min > MAX_INTENSITY_VARIATION_IN_SECTION:
            end_idx = max(current_start_idx, i - 1)
            
            sec_curve = curve[current_start_idx:end_idx+1]
            sec_intensities = [p[1] for p in sec_curve]
            sec_duration = sec_curve[-1][0] - sec_curve[0][0]
            sec_peak = max(sec_intensities) if sec_intensities else 0.0
            sec_mean = sum(sec_intensities) / len(sec_intensities) if sec_intensities else 0.0
            
            sections.append({
                'start_t': sec_curve[0][0],
                'duration': sec_duration,
                'peak_intensity': sec_peak,
                'mean_intensity': sec_mean,
                'bucket': get_bucket(sec_peak)  # Assign bucket based on PEAK!
            })
            
            current_start_idx = end_idx + 1
            i = current_start_idx # Re-evaluate from new start
        elif i == len(curve) - 1:
            sec_curve = curve[current_start_idx:i+1]
            sec_intensities = [p[1] for p in sec_curve]
            sec_duration = sec_curve[-1][0] - sec_curve[0][0]
            sec_peak = max(sec_intensities) if sec_intensities else 0.0
            sec_mean = sum(sec_intensities) / len(sec_intensities) if sec_intensities else 0.0
            
            sections.append({
                'start_t': sec_curve[0][0],
                'duration': sec_duration,
                'peak_intensity': sec_peak,
                'mean_intensity': sec_mean,
                'bucket': get_bucket(sec_peak)
            })
            i += 1
        else:
            i += 1

    # 2. Iterative Merge: Collapse adjacent identical buckets or tiny bridge pieces
    changed = True
    while changed:
        changed = False
        if len(sections) <= 1:
            break
        
        new_sections = [sections[0]]
        for j in range(1, len(sections)):
            sec = sections[j]
            prev = new_sections[-1]
            
            if (sec['bucket'] == prev['bucket'] or 
                sec['duration'] < MIN_SECTION_DURATION_SEC or 
                prev['duration'] < MIN_SECTION_DURATION_SEC):
                
                total_dur = prev['duration'] + sec['duration']
                new_peak = max(prev['peak_intensity'], sec['peak_intensity'])
                new_mean = ((prev['mean_intensity'] * prev['duration']) + (sec['mean_intensity'] * sec['duration'])) / total_dur if total_dur > 0 else 0.0
                
                prev['duration'] = total_dur
                prev['peak_intensity'] = new_peak
                prev['mean_intensity'] = new_mean
                prev['bucket'] = get_bucket(new_peak) # New bucket maintains the peak of both pieces
                changed = True
            else:
                new_sections.append(sec)
        sections = new_sections

    return sections

def analyze_funscript(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
            data = json.load(f)
            actions = data.get("actions", [])
    except Exception as e:
        sys.stderr.write(f"Error reading or parsing {file_path}: {e}\n")
        return None

    if len(actions) < 2:
        return None

    curve = calculate_intensity_curve(actions)
    if not curve:
        return None

    sections = compute_sections(curve)
    if not sections:
        return None

    # Compute Volatility Metrics
    total_duration_sec = sum(s['duration'] for s in sections)
    num_sections = len(sections)

    if total_duration_sec <= 0 or num_sections == 0:
        return None

    avg_section_duration = total_duration_sec / num_sections

    intensity_jumps = []
    for i in range(num_sections - 1):
        jump = abs(sections[i + 1]['mean_intensity'] - sections[i]['mean_intensity'])
        intensity_jumps.append(jump)
    avg_intensity_jump = (sum(intensity_jumps) / len(intensity_jumps)) if intensity_jumps else 0.0

    section_durations = [s['duration'] for s in sections]
    std_dev_section_duration = calculate_std_dev(section_durations)

    # Added min(1.0, ...) wrappers so metrics stay correctly bound
    avg_duration_norm = max(0.0, min(1.0, 1.0 - (avg_section_duration - 5.0) / 25.0))
    avg_jump_norm = max(0.0, min(1.0, (avg_intensity_jump - 5.0) / 35.0))
    std_dev_norm = max(0.0, min(1.0, std_dev_section_duration / 15.0))

    raw_volatility_score = (
        0.50 * avg_duration_norm +
        0.30 * avg_jump_norm +
        0.20 * std_dev_norm
    )
    
    volatility_rating = round(max(1.0, min(10.0, raw_volatility_score * 9.0 + 1.0)), 1)

    bucket_counts = Counter(s['bucket'] for s in sections)
    sorted_breakdown = sorted(
        bucket_counts.items(),
        key=lambda item: int(item[0].split('-')[0])
    )
    breakdown_str = ", ".join(f"{count}x ({b})" for b, count in sorted_breakdown)

    return {
        'num_sections': len(sections),
        'volatility': volatility_rating,
        'breakdown': breakdown_str,
        'duration': total_duration_sec
    }

def main():
    if len(sys.argv) < 2:
        print("Usage: python3 check_volatility.py <FUNSCRIPT_DIR>")
        sys.exit(1)

    funscript_dir = os.path.abspath(sys.argv[1])
    results = []

    print(f"Scanning funscripts in: {funscript_dir}...\n")

    for root, _, files in os.walk(funscript_dir):
        for file in files:
            if file.lower().endswith('.funscript'):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, funscript_dir)
                
                stats = analyze_funscript(full_path)
                if stats:
                    results.append({
                        'rel_path': rel_path,
                        'filename': file,
                        'volatility': stats['volatility'],
                        'num_sections': stats['num_sections'],
                        'breakdown': stats['breakdown']
                    })

    results.sort(key=lambda x: x['volatility'], reverse=True)

    print(f"{'Funscript Name':<45} | {'Volatility':<10} | {'Sections Breakdown':<45}")
    print("-" * 105)

    for res in results:
        short_name = res['filename'] if len(res['filename']) <= 45 else res['filename'][:42] + "..."
        vol_str = f"{res['volatility']:.1f}/10"
        sections_info = f"{res['num_sections']} sections: {res['breakdown']}"
        print(f"{short_name:<45} | {vol_str:<10} | {sections_info}")

if __name__ == '__main__':
    main()