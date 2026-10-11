import { type ChangeStaging, UNSTAGED_CHANGES } from '../transactions/change_staging.ts';
import { TransactionalMap } from '../transactions/transactional_collections.ts';
import type {
  AudioUpload,
  DocumentUpload,
  FileUpload,
  PhotoUpload,
  StoredAudioFile,
  StoredDocumentFile,
  StoredFile,
  StoredFileId,
  StoredPhotoFile,
  StoredVideoFile,
  StoredVoiceFile,
  ThumbnailUpload,
  VideoUpload,
  VoiceUpload,
} from '../types/stored_file.ts';

/** Random bytes behind a `file_id`, which Telegram's are much longer than a `file_unique_id`. */
const FILE_ID_BYTE_COUNT = 36;
const FILE_UNIQUE_ID_BYTE_COUNT = 12;

/**
 * Stores files under opaque identities, with the `file_id` each observer knows a file by and the
 * `file_path` each bot downloads it from.
 */
export class FileRepository {
  readonly #staging: ChangeStaging;
  readonly #filesById: TransactionalMap<StoredFileId, StoredFile>;
  readonly #filesByUniqueId: TransactionalMap<string, StoredFile>;
  readonly #observerFileIdsByObserverId: TransactionalMap<
    number,
    TransactionalMap<StoredFileId, string>
  >;
  readonly #storedFileIdsByObserverFileId: TransactionalMap<string, StoredFileId>;
  readonly #botFilePathsByBotId: TransactionalMap<number, TransactionalMap<StoredFileId, string>>;
  readonly #storedFileIdsByBotFilePathByBotId: TransactionalMap<
    number,
    TransactionalMap<string, StoredFileId>
  >;

  /** `staging` decides how the repository's writes take part in its session's transactions. */
  constructor(staging: ChangeStaging = UNSTAGED_CHANGES) {
    this.#staging = staging;
    this.#filesById = new TransactionalMap(staging);
    this.#filesByUniqueId = new TransactionalMap(staging);
    this.#observerFileIdsByObserverId = new TransactionalMap(staging);
    this.#storedFileIdsByObserverFileId = new TransactionalMap(staging);
    this.#botFilePathsByBotId = new TransactionalMap(staging);
    this.#storedFileIdsByBotFilePathByBotId = new TransactionalMap(staging);
  }

  /**
   * Stores an upload under a new identity. A document's, video's, or audio file's thumbnail is
   * stored as a file of its own, which users can download and know by a `file_id` of its own.
   */
  addFile(upload: PhotoUpload): StoredPhotoFile;
  addFile(upload: DocumentUpload): StoredDocumentFile;
  addFile(upload: VideoUpload): StoredVideoFile;
  addFile(upload: VoiceUpload): StoredVoiceFile;
  addFile(upload: AudioUpload): StoredAudioFile;
  addFile(upload: FileUpload): Exclude<StoredFile, { readonly type: 'thumbnail' }>;
  addFile(upload: FileUpload): Exclude<StoredFile, { readonly type: 'thumbnail' }> {
    if (upload.type === 'photo' || upload.type === 'voice') {
      return this.#store(upload);
    }
    const { thumbnail, ...file } = upload;
    return this.#store({
      ...file,
      ...(thumbnail === undefined ? {} : { thumbnail: this.#store(thumbnail) }),
    });
  }

  #store<
    Upload extends
      | PhotoUpload
      | Omit<DocumentUpload, 'thumbnail'>
      | Omit<VideoUpload, 'thumbnail'>
      | VoiceUpload
      | Omit<AudioUpload, 'thumbnail'>
      | ThumbnailUpload,
  >(
    upload: Upload,
  ): Upload & Pick<StoredFile, 'id' | 'uniqueId'> {
    const file = {
      ...upload,
      id: crypto.randomUUID(),
      uniqueId: createRandomIdentifier(FILE_UNIQUE_ID_BYTE_COUNT),
    };
    this.#filesById.set(file.id, file);
    this.#filesByUniqueId.set(file.uniqueId, file);
    return file;
  }

  getFile(fileId: StoredFileId): StoredFile | undefined {
    return this.#filesById.get(fileId);
  }

  getFileByUniqueId(uniqueId: string): StoredFile | undefined {
    return this.#filesByUniqueId.get(uniqueId);
  }

  /** Returns the `file_id` the observer knows a stored file by, assigning one on first sight. */
  getOrAssignObserverFileId(observerId: number, fileId: StoredFileId): string {
    const observerFileIds = this.#observerFileIdsByObserverId.get(observerId) ??
      new TransactionalMap<StoredFileId, string>(this.#staging);
    const assignedObserverFileId = observerFileIds.get(fileId);
    if (assignedObserverFileId !== undefined) {
      return assignedObserverFileId;
    }

    const observerFileId = createRandomIdentifier(FILE_ID_BYTE_COUNT);
    observerFileIds.set(fileId, observerFileId);
    this.#observerFileIdsByObserverId.set(observerId, observerFileIds);
    this.#storedFileIdsByObserverFileId.set(observerFileId, fileId);
    return observerFileId;
  }

  /** Finds the file an observer knows by a `file_id`; another observer's `file_id` finds none. */
  findObserverFile(observerId: number, observerFileId: string): StoredFile | undefined {
    const fileId = this.#storedFileIdsByObserverFileId.get(observerFileId);
    if (
      fileId === undefined ||
      this.#observerFileIdsByObserverId.get(observerId)?.get(fileId) !== observerFileId
    ) {
      return undefined;
    }
    return this.#filesById.get(fileId);
  }

  getBotFilePath(botId: number, fileId: StoredFileId): string | undefined {
    return this.#botFilePathsByBotId.get(botId)?.get(fileId);
  }

  /** How many files the bot has a `file_path` for. */
  countBotFilePaths(botId: number): number {
    return this.#botFilePathsByBotId.get(botId)?.size ?? 0;
  }

  /** Gives a stored file a `file_path` for the bot, which must not have one for it yet. */
  addBotFilePath(botId: number, fileId: StoredFileId, filePath: string): void {
    const filePaths = this.#botFilePathsByBotId.get(botId) ??
      new TransactionalMap<StoredFileId, string>(this.#staging);
    const fileIdsByPath = this.#storedFileIdsByBotFilePathByBotId.get(botId) ??
      new TransactionalMap<string, StoredFileId>(this.#staging);
    if (filePaths.has(fileId) || fileIdsByPath.has(filePath)) {
      throw new Error(`Bot ${botId} already has file path ${filePath} or one for file ${fileId}`);
    }
    filePaths.set(fileId, filePath);
    fileIdsByPath.set(filePath, fileId);
    this.#botFilePathsByBotId.set(botId, filePaths);
    this.#storedFileIdsByBotFilePathByBotId.set(botId, fileIdsByPath);
  }

  findBotFileByPath(botId: number, filePath: string): StoredFile | undefined {
    const fileId = this.#storedFileIdsByBotFilePathByBotId.get(botId)?.get(filePath);
    return fileId === undefined ? undefined : this.#filesById.get(fileId);
  }
}

/** Creates an identifier in Telegram's alphabet for file identifiers: unpadded base64url. */
function createRandomIdentifier(byteCount: number): string {
  return crypto.getRandomValues(new Uint8Array(byteCount)).toBase64({
    alphabet: 'base64url',
    omitPadding: true,
  });
}
