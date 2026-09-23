// @flow

import { getStudioRole, isStudioRoleId } from './Roles';

/**
 * The tool policy of the studio role stored on a sub-agent's request.
 *
 * `studioRoleId` is read from a persisted request and is not validated on load,
 * so this resolves it defensively:
 *
 * - a declared role yields its own allowed-tool subset and display name;
 * - an unrecognized id (the role was renamed or removed, or the cache is
 *   corrupt) yields an EMPTY allowed set, so every call is denied. That is the
 *   safe direction when the restriction cannot be determined — a read-only
 *   sub-agent must not regain mutations because its role disappeared — and it
 *   avoids passing the unknown id to `getStudioRole`, which throws and would
 *   stall the whole batch before a single call is dispatched;
 * - `null`/absent means a top-level request with no role: `roleResolved` is
 *   false and `allowedToolNames` is empty; the caller only applies the filter
 *   when a role id is present.
 *
 * In its own module (importing only the leaf `Roles`) so it can be unit-tested:
 * `AiGeneration/Utils.js` pulls in `EditorFunctions/index.js`, whose three.js
 * dependency does not load under the test transform.
 */
export const getRoleToolPolicy = (
  studioRoleId: string | null
): {|
  allowedToolNames: Array<string>,
  displayName: string | null,
  roleResolved: boolean,
|} => {
  if (studioRoleId && isStudioRoleId(studioRoleId)) {
    const role = getStudioRole((studioRoleId: any));
    return {
      allowedToolNames: role.allowedToolNames,
      displayName: role.displayName,
      roleResolved: true,
    };
  }
  return { allowedToolNames: [], displayName: null, roleResolved: false };
};

/**
 * Whether a request's studio role is read-only. An unresolvable role id is
 * treated as read-only: the restrictive direction (no edit-approval bypass, no
 * full script surface).
 */
export const isRoleReadOnly = (studioRoleId: string | null): boolean => {
  if (!studioRoleId) return false;
  if (!isStudioRoleId(studioRoleId)) return true;
  return getStudioRole((studioRoleId: any)).readOnly;
};
