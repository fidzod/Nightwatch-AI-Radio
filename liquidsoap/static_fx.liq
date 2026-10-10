## Ambient radio static/fuzz effect.
##
## Applied to the already-combined program source (music and/or injected
## speech, from radio.liq) — it operates *after* crossfade/fallback, so it
## doesn't know or care whether music or speech is currently playing.
##
## Two layers, driven by one state machine (idle -> fade_in -> hold ->
## fade_out -> idle) ticking every `step` seconds:
##
##   - `noise_level`: the SMOOTH envelope (0 -> this event's peak -> 0). Used
##     to duck the program source, so the music/speech itself never sounds
##     jittery — only the static layer does.
##   - `crackle_jitter`: a fast, independently-randomized multiplier on top of
##     the noise bed only (not on the program ducking), re-rolled every tick.
##     This is what turns a smooth swell into a flickering, crackly texture
##     instead of a clean rise and fall.
##
## The noise source itself is band-limited (filter.iir.butterworth.bandpass)
## rather than full-spectrum white noise — full-spectrum noise reads as rain/
## surf; narrowing it toward the upper-mid band reads as radio static.
##
## Per-event randomization: gap between events, total event duration, and
## peak loudness are all independently rolled, so events vary in frequency,
## length, and intensity rather than feeling metronomic or uniform.

def apply_static_fx(program_in) =
  # tunable ranges (seconds, unless noted)
  min_gap = 8.
  max_gap = 35.
  min_event_duration = 1.0
  max_event_duration = 4.0
  min_peak = 0.25 # quietest events only partially duck the program
  max_peak = 1.0 # loudest events duck it almost completely
  min_jitter = 0.35 # crackle flicker floor, as a fraction of the envelope
  max_jitter = 1.0
  step = 0.05 # state machine tick resolution
  bandpass_low = 500.
  bandpass_high = 5000.

  noise_level = ref(0.)
  crackle_jitter = ref(1.)
  phase = ref("idle") # "idle" | "in" | "hold" | "out"
  phase_elapsed = ref(0.)
  phase_duration = ref(random.float(min=min_gap, max=max_gap))
  peak_level = ref(max_peak)
  fade_duration = ref(min_event_duration / 3.)
  hold_duration = ref(min_event_duration / 3.)

  # `thread.run.recurrent(delay=step, ...)` asks to be called roughly every
  # `step` seconds, but under real scheduling load ticks can fire late. If we
  # advanced phase_elapsed by the *nominal* `step` on every call regardless,
  # the state machine's internal clock would quietly drift behind wall-clock
  # time — gaps/events configured for a few seconds could stretch far longer
  # in practice. So we measure the real elapsed time with `time()` instead.
  last_tick_at = ref(time())

  def roll_event_shape() =
    event_duration = random.float(min=min_event_duration, max=max_event_duration)
    # fade / hold / fade split: 30% / 40% / 30% of the total event length.
    fade_duration := event_duration * 0.3
    hold_duration := event_duration * 0.4
    peak_level := random.float(min=min_peak, max=max_peak)
  end

  def tick() =
    now = time()
    dt = now - last_tick_at()
    last_tick_at := now
    # Guard against a pathological first call or clock weirdness producing a
    # negative/huge delta; fall back to the nominal step in that case.
    elapsed = if dt > 0. and dt < 5. then dt else step end

    phase_elapsed := phase_elapsed() + elapsed
    crackle_jitter := random.float(min=min_jitter, max=max_jitter)

    if phase() == "idle" then
      noise_level := 0.
      if phase_elapsed() >= phase_duration() then
        roll_event_shape()
        phase := "in"
        phase_elapsed := 0.
      end
    elsif phase() == "in" then
      noise_level := min(peak_level(), peak_level() * (phase_elapsed() / fade_duration()))
      if phase_elapsed() >= fade_duration() then
        phase := "hold"
        phase_elapsed := 0.
      end
    elsif phase() == "hold" then
      noise_level := peak_level()
      if phase_elapsed() >= hold_duration() then
        phase := "out"
        phase_elapsed := 0.
      end
    elsif phase() == "out" then
      noise_level := max(0., peak_level() * (1. - (phase_elapsed() / fade_duration())))
      if phase_elapsed() >= fade_duration() then
        phase := "idle"
        phase_elapsed := 0.
        phase_duration := random.float(min=min_gap, max=max_gap)
      end
    end

    step
  end

  thread.run.recurrent(delay=step, tick)

  def noise_amp() =
    noise_level() * crackle_jitter()
  end

  def program_amp() =
    1. - noise_level()
  end

  static_bed =
    amplify(
      noise_amp,
      filter.iir.butterworth.bandpass(
        frequency1=bandpass_low,
        frequency2=bandpass_high,
        noise(),
      ),
    )
  ducked_program = amplify(program_amp, program_in)

  add(normalize=false, [ducked_program, static_bed])
end
