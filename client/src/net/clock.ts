/**
 * Clock synchronisation.
 *
 * Everything the server sends is stamped in *server* time. To render a remote cursor
 * "as it was 120ms ago" the client has to know what server time it is right now, and
 * `Date.now()` on two machines can disagree by seconds.
 *
 * The estimator is the NTP idea, cut down to what a cursor demo needs:
 *
 *   client sends ping at ct
 *   server replies with st (its clock at reply time)
 *   client receives at now
 *
 *   rtt    = now - ct
 *   offset = st + rtt/2 - now        // add to a local clock to get server time
 *
 * The rtt/2 assumption (symmetric paths) is wrong in general, but the error is bounded
 * by the path asymmetry and it is stable, which is what matters: a *consistent* offset
 * that is 8ms wrong is invisible, a jumpy offset is not.
 *
 * We keep a window of samples and trust the one with the lowest RTT — the least-queued
 * probe is the least-contaminated estimate — then ease the working offset toward it so
 * a new best sample never yanks the render timeline sideways.
 */

const WINDOW = 12;
/** Above this disagreement we stop easing and just jump (first sync, or a clock step). */
const SNAP_THRESHOLD_MS = 250;
const EASE = 0.2;

interface Sample {
  rtt: number;
  offset: number;
}

export class ClockSync {
  private samples: Sample[] = [];
  private offset = 0;
  private hasOffset = false;

  /** Exponentially smoothed RTT, and its mean absolute deviation (our jitter proxy). */
  private smoothedRtt = 0;
  private rttDeviation = 0;

  /** Seed from the `welcome` frame so the very first render is roughly right. */
  seed(serverTime: number, receivedAt: number): void {
    if (this.hasOffset) return;
    this.offset = serverTime - receivedAt;
    this.hasOffset = true;
  }

  /** @param ct client send time, @param st server reply time, @param now local receive time */
  addSample(ct: number, st: number, now: number): void {
    const rtt = Math.max(0, now - ct);
    const offset = st + rtt / 2 - now;

    this.samples.push({ rtt, offset });
    if (this.samples.length > WINDOW) this.samples.shift();

    if (this.smoothedRtt === 0) {
      this.smoothedRtt = rtt;
      this.rttDeviation = rtt / 2;
    } else {
      const error = rtt - this.smoothedRtt;
      this.smoothedRtt += error * 0.125;
      this.rttDeviation += (Math.abs(error) - this.rttDeviation) * 0.25;
    }

    let best = this.samples[0];
    for (const s of this.samples) if (s.rtt < best.rtt) best = s;

    if (!this.hasOffset || Math.abs(best.offset - this.offset) > SNAP_THRESHOLD_MS) {
      this.offset = best.offset;
      this.hasOffset = true;
    } else {
      this.offset += (best.offset - this.offset) * EASE;
    }
  }

  /** Current server time, as best we can tell. */
  serverNow(): number {
    return Date.now() + this.offset;
  }

  get rtt(): number {
    return this.smoothedRtt;
  }

  /** Jitter estimate in ms — how much RTT is bouncing around. Drives adaptive buffering. */
  get jitter(): number {
    return this.rttDeviation;
  }

  get ready(): boolean {
    return this.hasOffset;
  }

  reset(): void {
    // Offset survives a reconnect (the server clock did not change), but RTT history
    // describes a socket that no longer exists.
    this.samples = [];
    this.smoothedRtt = 0;
    this.rttDeviation = 0;
  }
}
