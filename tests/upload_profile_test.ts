import { checkBotUploadSize, MAX_BOT_UPLOAD_BYTES } from '../src/types/upload_profile.ts';

Deno.test('checkBotUploadSize applies each upload profile limit at its byte boundary', () => {
  const expectations = [
    { uploadProfile: 'cloud', maxFileSizeBytes: 52_428_800 },
    { uploadProfile: 'local', maxFileSizeBytes: 2_097_152_000 },
  ] as const;
  for (const { uploadProfile, maxFileSizeBytes } of expectations) {
    if (MAX_BOT_UPLOAD_BYTES[uploadProfile] !== maxFileSizeBytes) {
      throw new Error(`Expected the ${uploadProfile} limit to be ${maxFileSizeBytes} bytes`);
    }
    if (checkBotUploadSize(uploadProfile, maxFileSizeBytes) !== undefined) {
      throw new Error(`Expected a file of exactly the ${uploadProfile} limit to fit`);
    }
    const failure = checkBotUploadSize(uploadProfile, maxFileSizeBytes + 1);
    if (
      JSON.stringify(failure) !== JSON.stringify({
        reason: 'bot_upload_too_big',
        uploadProfile,
        fileSizeBytes: maxFileSizeBytes + 1,
        maxFileSizeBytes,
      })
    ) {
      throw new Error(`Expected a file over the ${uploadProfile} limit to fail`);
    }
  }
});
