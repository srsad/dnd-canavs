import {
  ParticipantAcl,
  RoomParticipant,
  RoomParticipantPermissions,
} from './rooms.types';

export function defaultPermissionsForRole(
  role: RoomParticipant['role'],
): RoomParticipantPermissions {
  if (role === 'gm') {
    return {
      editCanvas: true,
      moveAnyToken: true,
      manageParticipants: true,
    };
  }
  return {
    editCanvas: false,
    moveAnyToken: false,
    manageParticipants: false,
  };
}

export function effectivePermissions(
  participant: RoomParticipant,
): RoomParticipantPermissions {
  const base = defaultPermissionsForRole(participant.role);
  const p = participant.permissions;
  if (!p) {
    return base;
  }
  return {
    editCanvas: p.editCanvas ?? base.editCanvas,
    moveAnyToken: p.moveAnyToken ?? base.moveAnyToken,
    manageParticipants: p.manageParticipants ?? base.manageParticipants,
  };
}

/** Applies stored ACL overrides to a participant (session carries identity only). */
export function mergeParticipantWithAcl(
  participant: RoomParticipant,
  acl: ParticipantAcl,
): RoomParticipant {
  const entry = acl[participant.id];
  if (!entry?.permissions || Object.keys(entry.permissions).length === 0) {
    const { permissions: _drop, ...rest } = participant;
    return { ...rest };
  }
  return {
    ...participant,
    permissions: { ...entry.permissions },
  };
}
