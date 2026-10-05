import { getAudioFileExtension, getAudioMimeType } from '../src/media/audio_file.ts';

Deno.test('getAudioMimeType keeps audio types of file names and otherwise uses audio/mpeg', () => {
  const cases: readonly (readonly [string | undefined, string])[] = [
    ['track.mp3', 'audio/mpeg'],
    ['TRACK.M4A', 'audio/mp4'],
    ['live.flac', 'audio/flac'],
    ['demo.wav', 'audio/x-wav'],
    ['voice.ogg', 'audio/ogg'],
    // TDLib's `AudiosManager::get_input_media` uploads any other type as `audio/mpeg`.
    ['clip.mp4', 'audio/mpeg'],
    ['notes.txt', 'audio/mpeg'],
    ['untitled', 'audio/mpeg'],
    [undefined, 'audio/mpeg'],
  ];
  for (const [fileName, expectedMimeType] of cases) {
    const mimeType = getAudioMimeType(fileName);
    if (mimeType !== expectedMimeType) {
      throw new Error(`Expected ${fileName} to be ${expectedMimeType}, received ${mimeType}`);
    }
  }
});

Deno.test('getAudioFileExtension keeps the extensions TDLib keeps for audio files', () => {
  const cases: readonly (readonly [string | undefined, string])[] = [
    ['track.mp3', 'mp3'],
    ['track.m4a', 'm4a'],
    ['track.ogg', 'ogg'],
    ['track.oga', 'oga'],
    ['track.mpeg3', 'mpeg3'],
    // TDLib compares extensions exactly, and names every other audio file `.mp3`.
    ['TRACK.MP3', 'mp3'],
    ['live.flac', 'mp3'],
    ['untitled', 'mp3'],
    [undefined, 'mp3'],
  ];
  for (const [fileName, expectedExtension] of cases) {
    const extension = getAudioFileExtension(fileName);
    if (extension !== expectedExtension) {
      throw new Error(`Expected ${fileName} to get .${expectedExtension}, received .${extension}`);
    }
  }
});
