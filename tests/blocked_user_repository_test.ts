import { BlockedUserRepository } from '../src/repositories/blocked_user/blocked_user.ts';

Deno.test("BlockedUserRepository keeps each account's block list and reports changes", () => {
  const blockedUsers = new BlockedUserRepository();

  if (!blockedUsers.block(1, 10) || blockedUsers.block(1, 10)) {
    throw new Error('Expected only the first block of a user to change the block list');
  }
  if (!blockedUsers.isBlocked(1, 10) || blockedUsers.isBlocked(2, 10)) {
    throw new Error("Expected a block to apply only to the blocking account's list");
  }
  if (!blockedUsers.unblock(1, 10) || blockedUsers.unblock(1, 10) || blockedUsers.unblock(2, 10)) {
    throw new Error('Expected only unblocking a blocked user to change the block list');
  }
  if (blockedUsers.isBlocked(1, 10)) {
    throw new Error('Expected the unblocked user to leave the block list');
  }
});
