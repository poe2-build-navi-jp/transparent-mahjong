import { describe, expect, it } from 'vitest';
import { GameHost, type HostSnapshot } from '../src/net/host';

describe('host snapshot / manual scheduling', () => {
  it('a CPU-only game can be saved and restored between every step and still finishes', () => {
    let next: number | null = null;
    let now = 1_000_000;
    const realNow = Date.now;
    Date.now = () => now;
    try {
      const opts = { timed: true, cpuDelay: 10, schedule: (at: number | null) => { next = at; } };
      let host = new GameHost({ names: ['a', 'b', 'c', 'd'], cpu: [true, true, true, true], length: 'tonpu' }, [{}, {}, {}, {}], opts);
      host.start();
      let steps = 0;
      while (host.game.phase !== 'gameEnd' && steps < 20000) {
        expect(next).not.toBeNull();
        now = Math.max(now, next!);
        // サーバーが休止して状態を保存・復元したのと同じことをする
        const snap = JSON.parse(JSON.stringify(host.snapshot())) as HostSnapshot;
        host = GameHost.restore(snap, [{}, {}, {}, {}], opts);
        host.runDue(now);
        steps++;
      }
      expect(host.game.phase).toBe('gameEnd');
      expect(host.game.final!.ranking).toHaveLength(4);
    } finally {
      Date.now = realNow;
    }
  });
});
