import type { XUserProfile } from '@xshield/shared';

export interface SearchProvider {
  searchUsers(query: string): Promise<XUserProfile[]>;
}

export class EmptySearchProvider implements SearchProvider {
  async searchUsers(): Promise<XUserProfile[]> {
    return [];
  }
}
