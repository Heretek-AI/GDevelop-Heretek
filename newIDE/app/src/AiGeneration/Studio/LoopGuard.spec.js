// @flow
import {
  createLoopGuard,
  toolCallKey,
  DEFAULT_LOOP_GUARD_CONFIG,
} from './LoopGuard';

describe('LoopGuard', () => {
  describe('toolCallKey', () => {
    it('keys different arguments differently, however long the common prefix', () => {
      // munder-difflin #377: `input.slice(0, 200)` made nine different
      // measurements read as nine identical calls. Hashing the whole string is
      // what fixes it.
      const preamble = 'x'.repeat(300);
      const first = toolCallKey('run_script', `${preamble}first-measurement`);
      const second = toolCallKey('run_script', `${preamble}second-measurement`);
      expect(first).not.toBe(second);
    });

    it('keys identical arguments identically, and different tools differently', () => {
      expect(toolCallKey('create_scene', '{"a":1}')).toBe(
        toolCallKey('create_scene', '{"a":1}')
      );
      expect(toolCallKey('create_scene', '{"a":1}')).not.toBe(
        toolCallKey('create_scene', '{"a":2}')
      );
      expect(toolCallKey('create_scene', '{}')).not.toBe(
        toolCallKey('put_2d_instances', '{}')
      );
    });
  });

  describe('repeated tool call trip', () => {
    const call = (guard: any, args: string) =>
      guard.recordToolCall({ name: 'create_scene', arguments: args });

    it('trips at the configured limit and names the tool', () => {
      const guard = createLoopGuard({ repeatedToolLimit: 8 });
      for (let i = 0; i < 7; i++) call(guard, '{"scene_name":"Town"}');
      // Seven identical calls: not yet.
      expect(guard.evaluate().level).toBe('healthy');

      guard.recordToolCall({
        name: 'create_scene',
        arguments: '{"scene_name":"Town"}',
      });
      const decision = guard.evaluate();
      expect(decision.level).toBe('steering');
      expect(decision.reason).toContain('looping');
      expect(decision.reason).toContain('create_scene');
      expect(decision.action).toBe('steer');
    });

    it('is reset by an intervening different call', () => {
      const guard = createLoopGuard({ repeatedToolLimit: 3 });
      call(guard, '{"a":1}');
      call(guard, '{"a":1}');
      call(guard, '{"a":2}');
      // Only two identical in a row now.
      expect(guard.evaluate().level).toBe('healthy');
      call(guard, '{"a":2}');
      call(guard, '{"a":2}');
      expect(guard.evaluate().level).toBe('steering');
    });

    it('does not trip on two long arguments differing past character 300', () => {
      // The direct #377 regression, at the default limit.
      const guard = createLoopGuard({ repeatedToolLimit: 2 });
      const preamble = 'y'.repeat(300);
      guard.recordToolCall({
        name: 'run_script',
        arguments: `${preamble}A`,
      });
      guard.recordToolCall({
        name: 'run_script',
        arguments: `${preamble}B`,
      });
      expect(guard.evaluate().level).toBe('healthy');
    });
  });

  describe('error storm trip', () => {
    it('trips after the configured number of consecutive failures', () => {
      const guard = createLoopGuard({ errorStormLimit: 5 });
      for (let i = 0; i < 4; i++) guard.recordError();
      expect(guard.evaluate().level).toBe('healthy');

      guard.recordError();
      const decision = guard.evaluate();
      expect(decision.level).toBe('steering');
      expect(decision.reason).toContain('error storm');
      expect(decision.reason).toContain('5');
    });

    it('is reset by a success but not by a mere attempt', () => {
      // A distinct tool call is an attempt, not progress: the storm continues.
      const attempt = createLoopGuard({ errorStormLimit: 3 });
      attempt.recordError();
      attempt.recordError();
      attempt.recordToolCall({ name: 'create_scene', arguments: '{}' });
      attempt.recordError();
      expect(attempt.evaluate().level).toBe('steering');

      // A real success clears the storm.
      const success = createLoopGuard({ errorStormLimit: 3 });
      success.recordError();
      success.recordError();
      success.recordSuccess();
      success.recordError();
      success.recordError();
      expect(success.evaluate().level).toBe('healthy');
    });
  });

  describe('turn limit trip', () => {
    it('trips at the configured turn count', () => {
      const guard = createLoopGuard({ maxTurnsWithoutUserInput: 60 });
      for (let i = 0; i < 59; i++) guard.recordTurn();
      expect(guard.evaluate().level).toBe('healthy');

      guard.recordTurn();
      const decision = guard.evaluate();
      expect(decision.level).toBe('steering');
      expect(decision.reason).toContain('turn limit');
    });

    it('is cleared only by reset, not by tool calls or errors', () => {
      const guard = createLoopGuard({ maxTurnsWithoutUserInput: 3 });
      guard.recordTurn();
      guard.recordTurn();
      guard.recordTurn();
      // Progress does not clear the turn counter.
      guard.recordToolCall({ name: 'a', arguments: '{}' });
      guard.recordToolCall({ name: 'b', arguments: '{}' });
      guard.recordToolCall({ name: 'c', arguments: '{}' });
      guard.recordError();
      guard.recordError();
      expect(guard.evaluate().level).toBe('steering');

      guard.reset();
      expect(guard.evaluate().level).toBe('healthy');
    });
  });

  describe('escalation ladder', () => {
    it('climbs at most one level per evaluate and never past constrained', () => {
      const guard = createLoopGuard({
        repeatedToolLimit: 1,
        maxTurnsWithoutUserInput: 1000,
      });
      // One call is already a "loop" at limit 1.
      guard.recordToolCall({ name: 'a', arguments: '{}' });

      expect(guard.evaluate().level).toBe('steering');
      expect(guard.evaluate().level).toBe('constrained');
      // Capped: no 'stopped' level (there is no hardStop here).
      expect(guard.evaluate().level).toBe('constrained');
      expect(guard.evaluate().level).toBe('constrained');
    });

    it('reports an action only when the level escalates', () => {
      const guard = createLoopGuard({
        repeatedToolLimit: 1,
        maxTurnsWithoutUserInput: 1000,
      });
      guard.recordToolCall({ name: 'a', arguments: '{}' });

      const first = guard.evaluate();
      expect(first.level).toBe('steering');
      expect(first.action).toBe('steer');

      // Second tick escalates to constrained.
      const second = guard.evaluate();
      expect(second.level).toBe('constrained');
      expect(second.action).toBe('constrain');

      // Third tick does not escalate: no action, so a durable steer is not
      // re-sent.
      const third = guard.evaluate();
      expect(third.level).toBe('constrained');
      expect(third.action).toBe('none');
    });

    it('de-escalates a level per healthy evaluate', () => {
      const guard = createLoopGuard({
        repeatedToolLimit: 1,
        maxTurnsWithoutUserInput: 1000,
      });
      guard.recordToolCall({ name: 'a', arguments: '{}' });
      guard.evaluate(); // steering
      guard.evaluate(); // constrained

      // Clear the trip: the guard recovers one level per tick.
      guard.reset();
      const recovering = guard.evaluate();
      expect(recovering.level).toBe('steering');
      expect(recovering.reason).toBe('recovering');
      expect(recovering.action).toBe('none');

      expect(guard.evaluate().level).toBe('healthy');
      expect(guard.evaluate().level).toBe('healthy');
    });

    it('stays healthy and actionless when nothing trips', () => {
      const guard = createLoopGuard();
      guard.recordToolCall({ name: 'a', arguments: '{}' });
      const decision = guard.evaluate();
      expect(decision.level).toBe('healthy');
      expect(decision.action).toBe('none');
      expect(decision.changed).toBe(false);
    });

    it('reports healthy with no trip when disabled', () => {
      const guard = createLoopGuard({ enabled: false, repeatedToolLimit: 1 });
      guard.recordToolCall({ name: 'a', arguments: '{}' });
      const decision = guard.evaluate();
      expect(decision.level).toBe('healthy');
      expect(decision.action).toBe('none');
    });
  });

  describe('canonicalization and re-arming', () => {
    it('treats arguments that differ only in key order as the same call', () => {
      expect(toolCallKey('create_scene', '{"a":1,"b":2}')).toBe(
        toolCallKey('create_scene', '{"b":2,"a":1}')
      );
    });

    it('is not tripped by a benign A-B-A-B alternation', () => {
      const guard = createLoopGuard({ repeatedToolLimit: 3 });
      for (const args of [
        '{"a":1}',
        '{"a":2}',
        '{"a":1}',
        '{"a":2}',
        '{"a":1}',
      ]) {
        guard.recordToolCall({ name: 'create_scene', arguments: args });
      }
      expect(guard.evaluate().level).toBe('healthy');
    });

    it('re-emits an action on a re-trip after reset at the ceiling', () => {
      const guard = createLoopGuard({
        repeatedToolLimit: 1,
        maxTurnsWithoutUserInput: 1000,
      });
      guard.recordToolCall({ name: 'a', arguments: '{}' });
      guard.evaluate(); // steering
      guard.evaluate(); // constrained
      guard.evaluate(); // constrained (ceiling, durable: no action)
      expect(guard.evaluate().action).toBe('none');

      guard.reset();
      guard.recordToolCall({ name: 'a', arguments: '{}' });
      const retripped = guard.evaluate();
      expect(retripped.level).toBe('constrained');
      expect(retripped.action).toBe('constrain');
    });
  });

  describe('progress trip', () => {
    it('trips after N consecutive turns with no project change', () => {
      const guard = createLoopGuard({ maxTurnsWithoutProgress: 3 });
      guard.recordProgress(false);
      guard.recordProgress(false);
      expect(guard.evaluate().level).toBe('healthy');
      guard.recordProgress(false);
      const decision = guard.evaluate();
      expect(decision.level).toBe('steering');
      expect(decision.reason).toContain('no progress');
    });

    it('a project-changing turn resets the streak', () => {
      const guard = createLoopGuard({ maxTurnsWithoutProgress: 3 });
      guard.recordProgress(false);
      guard.recordProgress(false);
      // The task wrote something: it is not stuck.
      guard.recordProgress(true);
      guard.recordProgress(false);
      guard.recordProgress(false);
      expect(guard.evaluate().level).toBe('healthy');
    });

    it('reset clears the progress streak', () => {
      const guard = createLoopGuard({ maxTurnsWithoutProgress: 2 });
      guard.recordProgress(false);
      guard.recordProgress(false);
      expect(guard.evaluate().level).toBe('steering');
      guard.reset();
      expect(guard.evaluate().level).toBe('healthy');
    });
  });

  it('defaults are the documented ones', () => {
    expect(DEFAULT_LOOP_GUARD_CONFIG).toEqual({
      enabled: true,
      repeatedToolLimit: 8,
      errorStormLimit: 5,
      maxTurnsWithoutUserInput: 60,
      maxTurnsWithoutProgress: 5,
    });
  });
});
