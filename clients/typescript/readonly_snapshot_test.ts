/**
 * The client's response types, inferred from the control contracts, are readonly all the way down:
 * neither a nested field nor a list of a snapshot can be changed through its type. Each mutation
 * below must fail to type-check; `deno check` reports an `@ts-expect-error` that has no error.
 */
import type {
  BotApiCallEntry,
  ChatJoinRequest,
  EmulationSession,
  SupergroupInviteLink,
  UpdateDeliveredEntry,
  WebhookAttemptFailedEntry,
} from './mod.ts';

/** Mutations of nested fields and lists that the snapshot types must refuse; never called. */
export function mutateSnapshots(
  session: EmulationSession,
  joinRequest: ChatJoinRequest,
  inviteLink: SupergroupInviteLink,
  call: BotApiCallEntry,
  delivery: UpdateDeliveredEntry,
  failure: WebhookAttemptFailedEntry,
): void {
  // @ts-expect-error A snapshot's own field is readonly.
  session.uploadProfile = 'local';
  // @ts-expect-error A nested object's field is readonly.
  joinRequest.requester_contact.status = 'expired';
  // @ts-expect-error A nested list cannot grow.
  joinRequest.requester_contact.bot_ids.push(1);
  // @ts-expect-error A nested list's elements are readonly.
  joinRequest.requester_contact.bot_ids[0] = 1;
  // @ts-expect-error A snapshot's own field is readonly.
  inviteLink.is_revoked = true;
  // @ts-expect-error A list of objects cannot grow.
  call.uploaded_files.push({ field_name: 'document', file_name: 'a.txt', size_bytes: 1 });
  // @ts-expect-error An object in a list is readonly.
  call.uploaded_files[0].size_bytes = 0;
  // @ts-expect-error A record's members are readonly.
  call.parameters.text = 'Changed';
  // @ts-expect-error A nested union's fields are readonly.
  call.answer.ok = true;
  // @ts-expect-error An open Telegram object's fields are readonly.
  delivery.update.update_id = 0;
  // @ts-expect-error A nested union's fields are readonly.
  failure.failure.reason = 'timed_out';
}

Deno.test('Response snapshots are readonly all the way down', () => {
  // The checks are the `@ts-expect-error` mutations above, which `deno check` verifies.
  if (typeof mutateSnapshots !== 'function') {
    throw new Error('Expected the mutations to be declared');
  }
});
