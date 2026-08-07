import qrLoginService from '../auth/qrLogin';

// src/services/user/getUserLikedSongs.ts

export interface UserLikedSongsParams {
  token?: string;
  offset?: number;
  limit?: number;
}

export default async ({ token, offset, limit }: UserLikedSongsParams) =>
  qrLoginService.getUserLikedSongs(token, offset, limit);
