import { createInviteLinkHash, isInviteLinkHash } from '../src/types/chat_invite_link.ts';

Deno.test('isInviteLinkHash accepts every hash createInviteLinkHash creates', () => {
  for (let attempt = 0; attempt < 1_000; attempt++) {
    const hash = createInviteLinkHash();
    if (!isInviteLinkHash(hash)) {
      throw new Error(`Expected the created hash ${hash} to be an invite link hash`);
    }
  }
});

Deno.test('isInviteLinkHash accepts 16 characters of the whole base64url alphabet', () => {
  const hashes = ['ABCDEFGHIJKLMNOP', 'QRSTUVWXYZabcdef', 'ghijklmnopqrstuv', 'wxyz0123456789-_'];
  for (const hash of hashes) {
    if (!isInviteLinkHash(hash)) {
      throw new Error(`Expected ${hash} to be an invite link hash`);
    }
  }
});

Deno.test('isInviteLinkHash refuses texts of another length or alphabet', () => {
  const texts = [
    '',
    'A'.repeat(15),
    'A'.repeat(17),
    'AAAAAAAAAAAAAAA+',
    'AAAAAAAAAAAAAAA/',
    'AAAAAAAAAAAAAAA=',
    'AAAAAAAAAAAAAAA.',
    'AAAAAAAAAAAAAAA ',
    'AAAAAAAAAAAAAAAé',
    `${'A'.repeat(15)}\n`,
    // Eight astral characters, which are 16 UTF-16 code units long.
    '😀'.repeat(8),
  ];
  for (const text of texts) {
    if (isInviteLinkHash(text)) {
      throw new Error(`Expected ${JSON.stringify(text)} not to be an invite link hash`);
    }
  }
});
