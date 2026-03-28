import type { Participant, ParticipantPermissions } from '../types';

export function effectivePermissions(participant: Participant): ParticipantPermissions {
  const base: ParticipantPermissions =
    participant.role === 'gm'
      ? {
          editCanvas: true,
          moveAnyToken: true,
          manageParticipants: true,
        }
      : {
          editCanvas: false,
          moveAnyToken: false,
          manageParticipants: false,
        };
  const o = participant.permissions;
  if (!o) {
    return base;
  }
  return {
    editCanvas: o.editCanvas ?? base.editCanvas,
    moveAnyToken: o.moveAnyToken ?? base.moveAnyToken,
    manageParticipants: o.manageParticipants ?? base.manageParticipants,
  };
}
