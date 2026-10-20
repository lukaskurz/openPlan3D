export type CloudProviderId = 'google' | 'icloud';

/** A plan as one cloud account holds it. `version` changes whenever the plan's remote bytes change;
 *  `thumbnailVersion` whenever its preview does. Providers may extend this with their own handles. */
export interface RemoteProject {
  projectId: string;
  version: string;
  thumbnailVersion: string | null;
}

/** One signed-in cloud account. Every call may throw CloudAuthError once the sign-in has lapsed. */
export interface CloudProvider {
  readonly id: CloudProviderId;
  /** Stable for the account, so sync records from one account never apply to another. */
  readonly accountId: string;
  list(): Promise<RemoteProject[]>;
  get(projectId: string): Promise<RemoteProject | null>;
  read(remote: RemoteProject): Promise<string>;
  readThumbnail(remote: RemoteProject): Promise<string | null>;
  /** Creates the plan when `remote` is null, otherwise replaces it. Providers that can detect a
   *  concurrent change throw RemoteChangedError instead of overwriting it. A thumbnail, when given, is stored too. */
  write(projectId: string, raw: string, remote: RemoteProject | null, thumbnail?: string): Promise<RemoteProject>;
  writeThumbnail(remote: RemoteProject, thumbnail: string): Promise<RemoteProject>;
  /** Providers with a trash move the plan there, so a deletion that synced by mistake stays recoverable. */
  remove(remote: RemoteProject): Promise<void>;
}

/** The account must be connected again before syncing can continue. */
export class CloudAuthError extends Error {
  constructor(message = 'Sign in to your cloud account again to keep syncing.') {
    super(message);
    this.name = 'CloudAuthError';
  }
}

/** The remote plan changed after it was read; sync rereads it and decides again. */
export class RemoteChangedError extends Error {
  constructor() {
    super('The plan changed in the cloud while syncing.');
    this.name = 'RemoteChangedError';
  }
}
