// @flow
import { getRoleToolPolicy, isRoleReadOnly } from './RoleToolPolicy';
import { getStudioRole, MUTATING_TOOL_NAMES, STUDIO_ROLES } from './Roles';

describe('getRoleToolPolicy', () => {
  it('resolves a declared role to its own tool subset', () => {
    const policy = getRoleToolPolicy('tester');
    expect(policy.roleResolved).toBe(true);
    expect(policy.displayName).toBe(STUDIO_ROLES.tester.displayName);
    expect(policy.allowedToolNames).toBe(
      getStudioRole('tester').allowedToolNames
    );
  });

  it('denies every tool when the role id is unrecognized', () => {
    // `studioRoleId` is persisted and not validated on load, so a renamed or
    // removed role must not throw (which stalls the batch) and must not be
    // treated as "no role" (which would hand a read-only agent every tool).
    // '' is normalized to null at the call site (`aiRequest.studioRoleId || null`),
    // so only real, unknown ids are listed here.
    for (const stale of ['legacy-role', 'ghost', 'managerish']) {
      const policy = getRoleToolPolicy(stale);
      expect(policy.roleResolved).toBe(false);
      expect(policy.allowedToolNames).toEqual([]);
      expect(policy.displayName).toBe(null);
    }
  });

  it('leaves a top-level request (no role) unresolved with nothing allowed', () => {
    for (const none of [null, undefined]) {
      const policy = getRoleToolPolicy((none: any));
      expect(policy.roleResolved).toBe(false);
      expect(policy.allowedToolNames).toEqual([]);
    }
  });
});

describe('isRoleReadOnly', () => {
  it('is true for a read-only role and false for a mutating one', () => {
    expect(isRoleReadOnly('tester')).toBe(true);
    expect(isRoleReadOnly('developer')).toBe(false);
    expect(isRoleReadOnly('designer')).toBe(false);
  });

  it('treats an unrecognized role id as read-only', () => {
    // The restrictive direction: a sub-agent whose role cannot be resolved must
    // not be handed the edit-approval bypass or the full script surface.
    expect(isRoleReadOnly('legacy-role')).toBe(true);
    expect(isRoleReadOnly('ghost')).toBe(true);
  });

  it('treats an absent role as not read-only', () => {
    // A top-level request has no role and is not a sub-agent subject to one.
    expect(isRoleReadOnly(null)).toBe(false);
    expect(isRoleReadOnly(undefined)).toBe(false);
  });

  it('never lets an unresolved role reach a mutating tool', () => {
    // The end-to-end property the two helpers exist for.
    const policy = getRoleToolPolicy('legacy-role');
    MUTATING_TOOL_NAMES.forEach(name => {
      expect(policy.allowedToolNames).not.toContain(name);
    });
  });
});
