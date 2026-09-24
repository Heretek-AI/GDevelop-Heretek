// @flow

import jsSHA from '../../Utils/Sha256';

/**
 * The local loop guard: a circuit breaker for a BYOK agent.
 *
 * Ported from munder-difflin's `src/main/breaker.ts`, narrowed to what this
 * editor can actually observe. Under BYOK there is no server, so nothing counts
 * a runaway local agent: the hosted `repeated-tool-call-loop` error can never
 * fire, `MAX_AI_REQUEST_RETRIES_IN_A_ROW` is a UI gate the API enforces
 * (`AiRequestUtils.js`), and a model looping on *fresh* call ids is otherwise
 * unbounded.
 *
 * Three trips, all from munder-difflin:
 *  - `repeatedToolLimit` consecutive identical tool calls
 *    (`'looping: N identical calls to <name>'`);
 *  - `errorStormLimit` consecutive failed calls
 *    (`'error storm: N consecutive failures'`);
 *  - `maxTurnsWithoutUserInput` assistant turns, cleared only by `reset`
 *    (`'turn limit: N turns without user input'`) - the trip with no
 *    munder-difflin analogue that this editor needs.
 *
 * Escalation is munder-difflin's ladder (`breaker.ts` `tick`): one level per
 * `evaluate`, capped at `constrained` (there is no `hardStop` here - the guard
 * never kills a request, it steers and constrains). A non-tripping `evaluate`
 * de-escalates one level. `action` is non-`'none'` only when the level escalated,
 * so a durable steer is not re-sent every tick.
 *
 * Deliberately NOT ported: the cost and token-velocity trips (the BYOK path has
 * no usage feed), the `hardStop` level, and the `PreCompact` exemption (there is
 * no auto-compaction here).
 */

export type LoopGuardLevel = 'healthy' | 'steering' | 'constrained' | 'stopped';
export type LoopGuardAction = 'none' | 'steer' | 'constrain' | 'stop';

export type LoopGuardDecision = {|
  level: LoopGuardLevel,
  reason: string,
  action: LoopGuardAction,
  /** True when the level changed since the previous `evaluate` (either way). */
  changed: boolean,
|};

export const DEFAULT_LOOP_GUARD_CONFIG = {
  enabled: true,
  /** Trips on the Nth consecutive identical call; N-1 are tolerated. */
  repeatedToolLimit: 8,
  /** Trips on the Nth consecutive failed call; N-1 are tolerated. */
  errorStormLimit: 5,
  /**
   * Trips on the Nth assistant turn without a user message; N-1 are tolerated.
   * Generous on purpose: a legitimate long task (a `run_script` doing hundreds
   * of calls, a gameplay test) is not a loop.
   */
  maxTurnsWithoutUserInput: 60,
  /**
   * Trips on the Nth consecutive turn with no project-modifying tool call; N-1
   * are tolerated. A sub-agent that only inspects is stuck (this is the
   * objective's "zero project mods over N turns" thrash signature). Never
   * applied to the manager, whose job is to delegate without editing.
   */
  maxTurnsWithoutProgress: 5,
};

export type LoopGuardConfig = {
  enabled: boolean,
  repeatedToolLimit: number,
  errorStormLimit: number,
  maxTurnsWithoutUserInput: number,
  maxTurnsWithoutProgress: number,
};

const LEVELS: Array<LoopGuardLevel> = [
  'healthy',
  'steering',
  'constrained',
  'stopped',
];

const rank = (level: LoopGuardLevel): number => LEVELS.indexOf(level);

const actionFor = (level: LoopGuardLevel): LoopGuardAction => {
  if (level === 'steering') return 'steer';
  if (level === 'constrained') return 'constrain';
  if (level === 'stopped') return 'stop';
  return 'none';
};

/** Recursively stringify with object keys sorted, so key order is not identity. */
const stableStringify = (value: any): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

/**
 * Parse `argsJson` and re-emit it canonically (keys sorted) so two argument
 * objects that differ only in key order hash the same. A non-JSON string is
 * hashed as-is.
 */
const canonicalizeArgs = (argsJson: string): string => {
  try {
    return stableStringify(JSON.parse(argsJson || 'null'));
  } catch (error) {
    return argsJson || '';
  }
};

/**
 * The identity of a tool call: its name and a hash of its arguments, taken
 * whole and in canonical (key-sorted) form.
 *
 * Hashing the whole arguments is the point. munder-difflin's #377 records that
 * its old `input.slice(0, 200)` collided on Bash commands sharing a long
 * identical preamble - nine *different* measurements in a row read as nine
 * identical calls and constrained the agent. Different arguments must produce
 * different keys, however long their common prefix; canonicalizing means two
 * calls that differ only in argument key order are the *same* call.
 */
export const toolCallKey = (name: string, argsJson: string): string => {
  const shaObj = new jsSHA('SHA-256', 'TEXT', { encoding: 'UTF8' });
  shaObj.update(canonicalizeArgs(argsJson));
  return `${name}:${shaObj.getHash('HEX')}`;
};

export type LoopGuard = {|
  recordToolCall: (call: {| name: string, arguments: string |}) => void,
  recordSuccess: () => void,
  recordError: () => void,
  recordTurn: () => void,
  /** Record whether the last turn changed the project (progress). */
  recordProgress: (madeProgress: boolean) => void,
  reset: () => void,
  evaluate: () => LoopGuardDecision,
|};

export const createLoopGuard = (
  config?: Partial<LoopGuardConfig>
): LoopGuard => {
  const effectiveConfig: LoopGuardConfig = {
    ...DEFAULT_LOOP_GUARD_CONFIG,
    ...(config || {}),
  };

  let level: LoopGuardLevel = 'healthy';
  let reason = '';
  let repeatKey: string | null = null;
  let repeatCount = 0;
  let errorCount = 0;
  let turnCount = 0;
  let noProgressTurns = 0;
  let actionEmittedForTrip = false;

  const evaluateTrips = (): {| tripping: boolean, reason: string |} => {
    if (repeatCount >= effectiveConfig.repeatedToolLimit) {
      return {
        tripping: true,
        reason: `looping: ${repeatCount} identical calls to ${
          repeatKey ? repeatKey.split(':')[0] : 'a tool'
        }`,
      };
    }
    if (errorCount >= effectiveConfig.errorStormLimit) {
      return {
        tripping: true,
        reason: `error storm: ${errorCount} consecutive failures`,
      };
    }
    if (noProgressTurns >= effectiveConfig.maxTurnsWithoutProgress) {
      return {
        tripping: true,
        reason: `no progress: ${noProgressTurns} turns without changing the project`,
      };
    }
    if (turnCount >= effectiveConfig.maxTurnsWithoutUserInput) {
      return {
        tripping: true,
        reason: `turn limit: ${turnCount} turns without user input`,
      };
    }
    return { tripping: false, reason: '' };
  };

  return {
    recordToolCall: call => {
      const key = toolCallKey(call.name, call.arguments);
      if (key === repeatKey) {
        repeatCount++;
      } else {
        repeatKey = key;
        repeatCount = 1;
      }
    },
    recordSuccess: () => {
      // Only a real success clears the error storm: an attempt is not progress.
      errorCount = 0;
    },
    recordError: () => {
      errorCount++;
    },
    recordTurn: () => {
      turnCount++;
    },
    recordProgress: madeProgress => {
      // Any project change resets the streak: a task that reads for a while,
      // then writes, is not stuck. Only a stretch of pure inspection trips.
      noProgressTurns = madeProgress ? 0 : noProgressTurns + 1;
    },
    reset: () => {
      // A new user input: the counters start over, but the ladder is NOT
      // jumped back to healthy - it de-escalates one level per `evaluate`, so
      // the caller is not handed a steer it already acted on, and a user who
      // speaks during a constrained run sees it recover over the next ticks.
      repeatKey = null;
      repeatCount = 0;
      errorCount = 0;
      turnCount = 0;
      noProgressTurns = 0;
      actionEmittedForTrip = false;
    },
    evaluate: () => {
      if (!effectiveConfig.enabled) {
        const wasChanged = level !== 'healthy';
        level = 'healthy';
        reason = '';
        return {
          level,
          reason,
          action: 'none',
          changed: wasChanged,
        };
      }

      const trip = evaluateTrips();
      // The ceiling has no `hardStop` here: the guard steers and constrains,
      // it never kills a request.
      const ceiling: LoopGuardLevel = 'constrained';
      let target: LoopGuardLevel;
      if (trip.tripping) {
        target = LEVELS[Math.min(rank(level) + 1, rank(ceiling))];
      } else {
        target = LEVELS[Math.max(rank(level) - 1, 0)];
      }
      const changed = target !== level;
      const escalated = rank(target) > rank(level);
      level = target;
      reason = trip.tripping ? trip.reason : changed ? 'recovering' : reason;

      // Emit on an escalation (a new level carries its own action) or on a
      // fresh trip after a reset - but never re-send a durable action on every
      // tick. Re-armed by `reset` and on recovery.
      const shouldEmit = escalated || (trip.tripping && !actionEmittedForTrip);
      if (shouldEmit) {
        actionEmittedForTrip = true;
      } else if (!trip.tripping) {
        actionEmittedForTrip = false;
      }

      return {
        level,
        reason,
        action: shouldEmit ? actionFor(target) : 'none',
        changed,
      };
    },
  };
};
