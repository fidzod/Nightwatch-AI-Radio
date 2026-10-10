## Ambient radio static/fuzz effect.
##
## Applied to the already-combined program source (music and/or injected
## speech, from radio.liq) — it operates *after* crossfade/fallback, so it
## doesn't know or care whether music or speech is currently playing.
##
## A single recurring thread drives a small state machine (idle -> fade_in ->
## hold -> fade_out -> idle) that advances a shared `noise_level` ref between
## 0. and 1. Both the noise bed and the ducked program source read off the
## same ref as inverse envelopes, so they always stay in sync: as static
## swells in, the program ducks down; as it fades out, the program recovers.
## Event timing (gap between events) and burst shape (fade/hold duration) are
## independently randomized each cycle, so it never feels metronomic.

def apply_static_fx(program_in) =
  # tunable ranges (seconds)
  min_gap = 90.
  max_gap = 300.
  min_fade = 1.0
  max_fade = 3.0
  min_hold = 2.0
  max_hold = 5.0
  step = 0.05 # state machine tick resolution

  noise_level = ref(0.)
  phase = ref("idle") # "idle" | "in" | "hold" | "out"
  phase_elapsed = ref(0.)
  phase_duration = ref(random.float(min=min_gap, max=max_gap))
  fade_duration = ref(min_fade)
  hold_duration = ref(min_hold)

  def tick() =
    phase_elapsed := phase_elapsed() + step

    if phase() == "idle" then
      noise_level := 0.
      if phase_elapsed() >= phase_duration() then
        fade_duration := random.float(min=min_fade, max=max_fade)
        hold_duration := random.float(min=min_hold, max=max_hold)
        phase := "in"
        phase_elapsed := 0.
      end
    elsif phase() == "in" then
      noise_level := min(1., phase_elapsed() / fade_duration())
      if phase_elapsed() >= fade_duration() then
        phase := "hold"
        phase_elapsed := 0.
      end
    elsif phase() == "hold" then
      noise_level := 1.
      if phase_elapsed() >= hold_duration() then
        phase := "out"
        phase_elapsed := 0.
      end
    elsif phase() == "out" then
      noise_level := max(0., 1. - (phase_elapsed() / fade_duration()))
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
    noise_level()
  end

  def program_amp() =
    1. - noise_level()
  end

  static_bed = amplify(noise_amp, noise())
  ducked_program = amplify(program_amp, program_in)

  add(normalize=false, [ducked_program, static_bed])
end
